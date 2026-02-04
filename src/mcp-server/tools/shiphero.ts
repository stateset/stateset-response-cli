import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ShipHeroConfig } from '../../integrations/config.js';
import { shipheroGraphql } from '../../integrations/shiphero.js';
import { redactPii } from '../../integrations/redact.js';
import { stringifyToolResult } from './output.js';

export interface ShipHeroToolOptions {
  allowApply: boolean;
  redact: boolean;
}

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

function writeNotAllowed() {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        error: 'Write operation not allowed. The --apply flag or STATESET_ALLOW_APPLY must be set.',
        hint: 'Use list/get operations when writes are disabled.',
      }, null, 2),
    }],
  };
}

async function runShipHeroGraphql(
  shiphero: ShipHeroConfig,
  options: ShipHeroToolOptions,
  query: string,
  variables?: Record<string, unknown> | null
) {
  const response = await shipheroGraphql({ shiphero, query, variables: variables || {} });
  const data = options.redact ? redactPii(response.data) : response.data;
  return { status: response.status, data };
}

export function registerShipHeroTools(server: McpServer, shiphero: ShipHeroConfig, options: ShipHeroToolOptions) {
  server.tool(
    'shiphero_list_orders',
    'List ShipHero orders with filters.',
    {
      order_status: z.enum(['pending', 'processing', 'allocated', 'picked', 'packed', 'shipped', 'cancelled', 'on_hold', 'backorder']).optional(),
      shop_name: z.string().optional().describe('Filter by shop name'),
      warehouse_id: z.string().optional().describe('Filter by warehouse ID'),
      sku: z.string().optional().describe('Filter by SKU'),
      created_after: z.string().optional().describe('Orders created after (ISO date)'),
      created_before: z.string().optional().describe('Orders created before (ISO date)'),
      limit: z.number().min(1).max(100).optional().describe('Max orders to return'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shiphero_get_order',
    'Get a ShipHero order by ID.',
    {
      order_id: z.string().describe('ShipHero order ID'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runShipHeroGraphql(shiphero, options, GET_ORDER_QUERY, { id: args.order_id });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shiphero_update_order',
    'Update ShipHero order fields (priority, hold, notes). Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_id: z.string().describe('ShipHero order ID'),
      priority: z.enum(['normal', 'high', 'urgent']).optional(),
      on_hold: z.boolean().optional().describe('Put order on hold or release'),
      notes: z.string().optional().describe('Internal notes'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const result = await runShipHeroGraphql(shiphero, options, UPDATE_ORDER_MUTATION, {
        id: args.order_id,
        priority: args.priority,
        on_hold: args.on_hold,
        notes: args.notes,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shiphero_create_shipment',
    'Create a shipment for a ShipHero order. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_id: z.string().describe('ShipHero order ID'),
      carrier: z.string().describe('Carrier name (e.g., usps, ups)'),
      service: z.string().describe('Service level'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const result = await runShipHeroGraphql(shiphero, options, CREATE_SHIPMENT_MUTATION, {
        order_id: args.order_id,
        carrier: args.carrier,
        service: args.service,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shiphero_get_inventory',
    'Get ShipHero inventory levels for a SKU.',
    {
      sku: z.string().describe('Product SKU'),
      warehouse_id: z.string().optional().describe('Filter by warehouse ID'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runShipHeroGraphql(shiphero, options, GET_INVENTORY_QUERY, {
        sku: args.sku,
        warehouse_id: args.warehouse_id,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shiphero_adjust_inventory',
    'Adjust ShipHero inventory count. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      sku: z.string().describe('Product SKU'),
      warehouse_id: z.string().describe('Warehouse ID'),
      adjustment: z.number().describe('Quantity to add (positive) or remove (negative)'),
      reason: z.enum(['received', 'cycle_count', 'damaged', 'lost', 'returned', 'transferred', 'other']).describe('Adjustment reason'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const result = await runShipHeroGraphql(shiphero, options, ADJUST_INVENTORY_MUTATION, {
        sku: args.sku,
        warehouse_id: args.warehouse_id,
        quantity: Math.round(args.adjustment),
        reason: args.reason,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shiphero_list_warehouses',
    'List ShipHero warehouses.',
    {
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runShipHeroGraphql(shiphero, options, LIST_WAREHOUSES_QUERY);
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shiphero_route_order',
    'Route a ShipHero order to a specific warehouse. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_id: z.string().describe('ShipHero order ID'),
      warehouse_id: z.string().describe('Target warehouse ID'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const result = await runShipHeroGraphql(shiphero, options, ROUTE_ORDER_MUTATION, {
        order_id: args.order_id,
        warehouse_id: args.warehouse_id,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shiphero_batch_ship_orders',
    'Create shipments for multiple ShipHero orders. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_ids: z.array(z.string()).min(1).describe('Order IDs'),
      carrier: z.string().describe('Carrier for all shipments'),
      service: z.string().describe('Service level for all shipments'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

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
          errors.push({ order_id: orderId, error: error instanceof Error ? error.message : String(error) });
        }
      }

      const payload = {
        success: errors.length === 0,
        total_requested: args.order_ids.length,
        shipped: results.length,
        failed: errors.length,
        errors: errors.length > 0 ? errors : undefined,
      };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shiphero_graphql',
    'Execute a raw ShipHero GraphQL query. Requires --apply or STATESET_ALLOW_APPLY for mutations.',
    {
      query: z.string().describe('GraphQL query or mutation'),
      variables: z.record(z.any()).optional().describe('GraphQL variables'),
      is_mutation: z.boolean().optional().default(false).describe('Set true if running a mutation'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (args.is_mutation && !options.allowApply) {
        return writeNotAllowed();
      }

      const result = await runShipHeroGraphql(shiphero, options, args.query as string, args.variables as Record<string, unknown> | undefined);
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );
}
