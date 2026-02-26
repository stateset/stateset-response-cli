import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ShipHeroConfig } from '../../integrations/config.js';
import { shipheroGraphql } from '../../integrations/shiphero.js';
import { redactPii } from '../../integrations/redact.js';
import { getErrorMessage } from '../../lib/errors.js';
import {
  type IntegrationToolOptions,
  guardWrite,
  wrapToolResult,
  MaxCharsSchema,
} from './helpers.js';

const LIST_ORDERS_QUERY = `
  query listOrders($shop_name: String, $order_status: String, $warehouse_id: String, $sku: String, $created_from: ISODateTime, $created_to: ISODateTime, $first: Int) {
    orders(shop_name: $shop_name, order_status: $order_status, warehouse_id: $warehouse_id, sku: $sku, created_from: $created_from, created_to: $created_to, first: $first) {
      edges {
        node {
          id
          order_number
          shop_name
          fulfillment_status
          order_date
          required_ship_date
          shipping_address {
            name
            city
            state
            zip
            country
          }
          line_items {
            edges {
              node {
                sku
                name
                quantity
                quantity_allocated
              }
            }
          }
        }
      }
    }
  }
`;

const GET_ORDER_QUERY = `
  query getOrder($id: String!) {
    order(id: $id) {
      id
      order_number
      shop_name
      fulfillment_status
      order_date
      required_ship_date
      priority
      on_hold
      notes
      shipping_address {
        name
        address1
        address2
        city
        state
        zip
        country
        phone
      }
      line_items {
        edges {
          node {
            id
            sku
            name
            quantity
            quantity_allocated
            quantity_shipped
            unit_price
          }
        }
      }
      shipments {
        id
        carrier
        shipping_method
        tracking_number
        created_at
      }
    }
  }
`;

const UPDATE_ORDER_MUTATION = `
  mutation updateOrder($id: String!, $priority: String, $on_hold: Boolean, $notes: String) {
    order_update(data: { order_id: $id, priority: $priority, hold: $on_hold, packing_note: $notes }) {
      order {
        id
        order_number
      }
    }
  }
`;

const CREATE_SHIPMENT_MUTATION = `
  mutation createShipment($order_id: String!, $carrier: String!, $service: String!) {
    shipment_create(data: { order_id: $order_id, carrier: $carrier, shipping_method: $service }) {
      shipment {
        id
        tracking_number
        carrier
        shipping_method
      }
    }
  }
`;

const GET_INVENTORY_QUERY = `
  query getInventory($sku: String!, $warehouse_id: String) {
    inventory(sku: $sku, warehouse_id: $warehouse_id) {
      edges {
        node {
          sku
          warehouse_id
          on_hand
          allocated
          available
          backorder
        }
      }
    }
  }
`;

const ADJUST_INVENTORY_MUTATION = `
  mutation adjustInventory($sku: String!, $warehouse_id: String!, $quantity: Int!, $reason: String!) {
    inventory_adjust(data: { sku: $sku, warehouse_id: $warehouse_id, quantity: $quantity, reason: $reason }) {
      inventory {
        sku
        on_hand
        available
      }
    }
  }
`;

const LIST_WAREHOUSES_QUERY = `
  query listWarehouses {
    warehouses {
      edges {
        node {
          id
          name
          address {
            city
            state
            country
          }
          active
        }
      }
    }
  }
`;

const ROUTE_ORDER_MUTATION = `
  mutation routeOrder($order_id: String!, $warehouse_id: String!) {
    order_route(data: { order_id: $order_id, warehouse_id: $warehouse_id }) {
      order {
        id
        order_number
      }
    }
  }
`;

const CANCEL_SHIPMENT_MUTATION = `
  mutation cancelShipment($shipment_id: String!, $reason: String) {
    shipment_cancel(data: { shipment_id: $shipment_id, reason: $reason }) {
      shipment {
        id
      }
    }
  }
`;

const CREATE_RETURN_MUTATION = `
  mutation createReturn($order_id: String!, $reason: String, $items: JSON) {
    return_create(data: { order_id: $order_id, reason: $reason, items: $items }) {
      return {
        id
      }
    }
  }
`;

const UPDATE_RETURN_MUTATION = `
  mutation updateReturn($return_id: String!, $status: String, $notes: String) {
    return_update(data: { return_id: $return_id, status: $status, notes: $notes }) {
      return {
        id
      }
    }
  }
`;

const shipheroIdempotencyStore = new Map<string, { status: number; data: unknown }>();

function withShipHeroIdempotency(
  key: string | undefined,
  status: number,
  data: unknown,
): { deduplicated: boolean; status: number; data: unknown } {
  if (!key) return { deduplicated: false, status, data };
  const existing = shipheroIdempotencyStore.get(key);
  if (existing) {
    return { deduplicated: true, status: existing.status, data: existing.data };
  }
  shipheroIdempotencyStore.set(key, { status, data });
  return { deduplicated: false, status, data };
}

async function runShipHeroGraphql(
  shiphero: ShipHeroConfig,
  options: IntegrationToolOptions,
  query: string,
  variables?: Record<string, unknown> | null,
) {
  const response = await shipheroGraphql({ shiphero, query, variables: variables || {} });
  const data = options.redact ? redactPii(response.data) : response.data;
  return { status: response.status, data };
}

export function registerShipHeroTools(
  server: McpServer,
  shiphero: ShipHeroConfig,
  options: IntegrationToolOptions,
) {
  server.tool(
    'shiphero_list_orders',
    'List ShipHero orders with filters.',
    {
      order_status: z
        .enum([
          'pending',
          'processing',
          'allocated',
          'picked',
          'packed',
          'shipped',
          'cancelled',
          'on_hold',
          'backorder',
        ])
        .optional(),
      shop_name: z.string().optional().describe('Filter by shop name'),
      warehouse_id: z.string().optional().describe('Filter by warehouse ID'),
      sku: z.string().optional().describe('Filter by SKU'),
      created_after: z.string().optional().describe('Orders created after (ISO date)'),
      created_before: z.string().optional().describe('Orders created before (ISO date)'),
      limit: z.number().min(1).max(100).optional().describe('Max orders to return'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runShipHeroGraphql(shiphero, options, LIST_ORDERS_QUERY, {
        shop_name: args.shop_name,
        order_status: args.order_status,
        warehouse_id: args.warehouse_id,
        sku: args.sku,
        created_from: args.created_after,
        created_to: args.created_before,
        first: args.limit || 50,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shiphero_get_order',
    'Get a ShipHero order by ID.',
    {
      order_id: z.string().describe('ShipHero order ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runShipHeroGraphql(shiphero, options, GET_ORDER_QUERY, {
        id: args.order_id,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shiphero_update_order',
    'Update ShipHero order fields (priority, hold, notes). Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_id: z.string().describe('ShipHero order ID'),
      priority: z.enum(['normal', 'high', 'urgent']).optional(),
      on_hold: z.boolean().optional().describe('Put order on hold or release'),
      notes: z.string().optional().describe('Internal notes'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await runShipHeroGraphql(shiphero, options, UPDATE_ORDER_MUTATION, {
        id: args.order_id,
        priority: args.priority,
        on_hold: args.on_hold,
        notes: args.notes,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shiphero_create_shipment',
    'Create a shipment for a ShipHero order. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_id: z.string().describe('ShipHero order ID'),
      carrier: z.string().describe('Carrier name (e.g., usps, ups)'),
      service: z.string().describe('Service level'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await runShipHeroGraphql(shiphero, options, CREATE_SHIPMENT_MUTATION, {
        order_id: args.order_id,
        carrier: args.carrier,
        service: args.service,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shiphero_get_inventory',
    'Get ShipHero inventory levels for a SKU.',
    {
      sku: z.string().describe('Product SKU'),
      warehouse_id: z.string().optional().describe('Filter by warehouse ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runShipHeroGraphql(shiphero, options, GET_INVENTORY_QUERY, {
        sku: args.sku,
        warehouse_id: args.warehouse_id,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shiphero_adjust_inventory',
    'Adjust ShipHero inventory count. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      sku: z.string().describe('Product SKU'),
      warehouse_id: z.string().describe('Warehouse ID'),
      adjustment: z.number().describe('Quantity to add (positive) or remove (negative)'),
      reason: z
        .enum(['received', 'cycle_count', 'damaged', 'lost', 'returned', 'transferred', 'other'])
        .describe('Adjustment reason'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await runShipHeroGraphql(shiphero, options, ADJUST_INVENTORY_MUTATION, {
        sku: args.sku,
        warehouse_id: args.warehouse_id,
        quantity: Math.round(args.adjustment),
        reason: args.reason,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shiphero_list_warehouses',
    'List ShipHero warehouses.',
    {
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runShipHeroGraphql(shiphero, options, LIST_WAREHOUSES_QUERY);
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shiphero_route_order',
    'Route a ShipHero order to a specific warehouse. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_id: z.string().describe('ShipHero order ID'),
      warehouse_id: z.string().describe('Target warehouse ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await runShipHeroGraphql(shiphero, options, ROUTE_ORDER_MUTATION, {
        order_id: args.order_id,
        warehouse_id: args.warehouse_id,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shiphero_batch_ship_orders',
    'Create shipments for multiple ShipHero orders. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_ids: z.array(z.string()).min(1).describe('Order IDs'),
      carrier: z.string().describe('Carrier for all shipments'),
      service: z.string().describe('Service level for all shipments'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const results: Array<{ order_id: string; success: boolean }> = [];
      const errors: Array<{ order_id: string; error: string }> = [];

      for (const orderId of args.order_ids) {
        try {
          await shipheroGraphql({
            shiphero,
            query: CREATE_SHIPMENT_MUTATION,
            variables: { order_id: orderId, carrier: args.carrier, service: args.service },
          });
          results.push({ order_id: orderId, success: true });
        } catch (error) {
          errors.push({
            order_id: orderId,
            error: getErrorMessage(error),
          });
        }
      }

      return wrapToolResult(
        {
          success: errors.length === 0,
          total_requested: args.order_ids.length,
          shipped: results.length,
          failed: errors.length,
          errors: errors.length > 0 ? errors : undefined,
        },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shiphero_set_order_hold',
    'Put a ShipHero order on hold or release it. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_id: z.string().describe('ShipHero order ID'),
      on_hold: z.boolean().describe('true to hold, false to release'),
      note: z.string().optional().describe('Optional packing note'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        query: UPDATE_ORDER_MUTATION,
        variables: { id: args.order_id, on_hold: args.on_hold, notes: args.note },
      };
      if (args.dry_run) {
        return wrapToolResult(
          { success: true, dry_run: true, idempotency_key: args.idempotency_key || null, request },
          args.max_chars as number | undefined,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await runShipHeroGraphql(shiphero, options, request.query, request.variables);
      const deduped = withShipHeroIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        { success: true, idempotency_key: args.idempotency_key || null, ...deduped },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shiphero_cancel_shipment',
    'Cancel a ShipHero shipment. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      shipment_id: z.string().describe('ShipHero shipment ID'),
      reason: z.string().optional().describe('Optional cancel reason'),
      mutation_override: z
        .string()
        .optional()
        .describe('Optional GraphQL mutation override for account-specific schemas'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const mutation = args.mutation_override || CANCEL_SHIPMENT_MUTATION;
      const variables = { shipment_id: args.shipment_id, reason: args.reason };
      if (args.dry_run) {
        return wrapToolResult(
          {
            success: true,
            dry_run: true,
            idempotency_key: args.idempotency_key || null,
            request: { mutation, variables },
          },
          args.max_chars as number | undefined,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await runShipHeroGraphql(shiphero, options, mutation, variables);
      const deduped = withShipHeroIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        { success: true, idempotency_key: args.idempotency_key || null, ...deduped },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shiphero_create_return',
    'Create a ShipHero return. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_id: z.string().describe('ShipHero order ID'),
      reason: z.string().optional().describe('Return reason'),
      items: z.array(z.record(z.unknown())).optional().describe('Return line items payload'),
      mutation_override: z
        .string()
        .optional()
        .describe('Optional GraphQL mutation override for account-specific schemas'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const mutation = args.mutation_override || CREATE_RETURN_MUTATION;
      const variables = { order_id: args.order_id, reason: args.reason, items: args.items };
      if (args.dry_run) {
        return wrapToolResult(
          {
            success: true,
            dry_run: true,
            idempotency_key: args.idempotency_key || null,
            request: { mutation, variables },
          },
          args.max_chars as number | undefined,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await runShipHeroGraphql(shiphero, options, mutation, variables);
      const deduped = withShipHeroIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        { success: true, idempotency_key: args.idempotency_key || null, ...deduped },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shiphero_update_return',
    'Update a ShipHero return. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      return_id: z.string().describe('ShipHero return ID'),
      status: z.string().optional().describe('Return status'),
      notes: z.string().optional().describe('Return notes'),
      mutation_override: z
        .string()
        .optional()
        .describe('Optional GraphQL mutation override for account-specific schemas'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const mutation = args.mutation_override || UPDATE_RETURN_MUTATION;
      const variables = { return_id: args.return_id, status: args.status, notes: args.notes };
      if (args.dry_run) {
        return wrapToolResult(
          {
            success: true,
            dry_run: true,
            idempotency_key: args.idempotency_key || null,
            request: { mutation, variables },
          },
          args.max_chars as number | undefined,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await runShipHeroGraphql(shiphero, options, mutation, variables);
      const deduped = withShipHeroIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        { success: true, idempotency_key: args.idempotency_key || null, ...deduped },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shiphero_resolve_order_exception',
    'Resolve a ShipHero order exception by releasing hold, optionally reprioritizing, and adding a note.',
    {
      order_id: z.string().describe('ShipHero order ID'),
      release_hold: z
        .boolean()
        .optional()
        .default(true)
        .describe('Release hold if currently blocked'),
      priority: z.enum(['normal', 'high', 'urgent']).optional().describe('Optional new priority'),
      note: z.string().optional().describe('Resolution note'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const variables = {
        id: args.order_id,
        on_hold: args.release_hold ? false : undefined,
        priority: args.priority,
        notes: args.note,
      };
      if (args.dry_run) {
        return wrapToolResult(
          {
            success: true,
            dry_run: true,
            idempotency_key: args.idempotency_key || null,
            request: { query: UPDATE_ORDER_MUTATION, variables },
          },
          args.max_chars as number | undefined,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await runShipHeroGraphql(shiphero, options, UPDATE_ORDER_MUTATION, variables);
      const deduped = withShipHeroIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        { success: true, idempotency_key: args.idempotency_key || null, ...deduped },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shiphero_graphql',
    'Execute a raw ShipHero GraphQL query. Requires --apply or STATESET_ALLOW_APPLY for mutations.',
    {
      query: z.string().describe('GraphQL query or mutation'),
      variables: z.record(z.unknown()).optional().describe('GraphQL variables'),
      is_mutation: z.boolean().optional().default(false).describe('Set true if running a mutation'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      if (args.is_mutation) {
        const blocked = guardWrite(options);
        if (blocked) return blocked;
      }

      const result = await runShipHeroGraphql(
        shiphero,
        options,
        args.query as string,
        args.variables as Record<string, unknown> | undefined,
      );
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );
}
