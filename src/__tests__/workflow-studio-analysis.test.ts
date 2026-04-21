import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { analyzeWorkflowStudioFeedback } from '../lib/workflow-studio-analysis.js';

const TICKET_HEADER =
  'Ticket id,Tags,Initial channel,Priority,Last used integration name,Last used integration type,Created by an agent,Subject,Creation date,Closed date,Survey score,Survey replied date,Assignee name,Assignee email,Customer email,Customer name,First response time (s),Resolution time (s),Number of agent messages,Number of customer messages,Ticket URL,Ticket Field: AI Intent,Ticket Field: Brand,Ticket Field: Customer Type,Ticket Field: Type,Ticket Field: AI Agent Outcome,Ticket Field: AI Agent Sales Opportunity,Ticket Field: AI Agent Sales Discount,Ticket Field: Managed sentiment,Ticket Field: Call status,Customer Field: Customer Type';

const RESPONSE_HEADER = 'Date,Channel,Customer Message,Response,Rating,Ticket ID,Handled By';

function makeFixtureDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-feedback-analysis-'));
}

describe('analyzeWorkflowStudioFeedback', () => {
  it('summarizes local ticket and response exports into config suggestions', () => {
    const root = makeFixtureDir();
    fs.mkdirSync(path.join(root, 'tickets'), { recursive: true });

    const ticketsCsv = [
      TICKET_HEADER,
      '1001,"agent-take-over,Ecoriginals AU",email,normal,Customer service EO,outlook,False,Cancel my subscription,2026-04-14 10:00:00,,,,Elle,response@stateset.io,one@example.com,One Customer,205,800,2,2,https://example.com/tickets/1001,Subscription::Cancel::Other,Ecoriginals - AU,Retail::Retail Subscription,Account Management::Cancellation,,,,,,',
      '1002,"agent-take-over,Ecoriginals AU",email,normal,Customer service EO,outlook,False,Need to stop my plan,2026-04-14 10:05:00,,,,Elle,response@stateset.io,two@example.com,Two Customer,210,900,2,2,https://example.com/tickets/1002,Subscription::Cancel::Other,Ecoriginals - AU,Retail::Retail Subscription,Account Management::Cancellation,,,,,,',
      '1003,"auto-close,Ecoriginals AU,non-support-related,wholesale",email,normal,Sales Team Ecoriginals,outlook,False,Expo calendar,2026-04-14 10:10:00,,,,Sales Team,sales@example.com,lead@example.com,Wholesale Lead,0,1,0,1,https://example.com/tickets/1003,Other::No Reply::Other,Ecoriginals - AU,Wholesale,Other::No Reply::Other,,,,,,',
      '1004,Ecoriginals US,email,normal,Customer service EO,outlook,False,US ticket,2026-04-14 10:10:00,,,,Elle,response@stateset.io,us@example.com,US Customer,220,600,1,1,https://example.com/tickets/1004,Order::Status::Other,Ecoriginals - US,Retail::Retail Standard,Information Request::Order Status,,,,,,',
    ].join('\n');
    fs.writeFileSync(path.join(root, 'tickets', 'tickets.csv'), ticketsCsv, 'utf-8');

    const responsesCsv = [
      RESPONSE_HEADER,
      '"Apr 14, 10:15 AM","email","Customer asked to cancel.","We can help with that. If this message was meant for another brand, please let us know.","positive","1001","Elle"',
      '"Apr 14, 10:16 AM","email","Please stop my subscription.","We have cancelled the next shipment.","positive","1002","Elle"',
      '"Apr 14, 10:17 AM","email","Can we sell through your channel?","Thanks for reaching out.","","1003","Elle"',
    ].join('\n');
    fs.writeFileSync(path.join(root, 'responses-page-export.csv'), responsesCsv, 'utf-8');

    const analysis = analyzeWorkflowStudioFeedback({
      brandRef: 'ecoriginals-au',
      cwd: root,
      sourcePath: root,
    });

    expect(analysis.brand_slug).toBe('ecoriginals-au');
    expect(analysis.totals.matched_ticket_rows).toBe(3);
    expect(analysis.totals.matched_response_rows).toBe(3);
    expect(analysis.totals.agent_takeover_rows).toBe(2);
    expect(analysis.totals.brand_boundary_responses).toBe(1);
    expect(analysis.proposal.classification_focus[0]?.value).toBe('Subscription::Cancel::Other');
    expect(analysis.proposal.review_gate_focus[0]?.value).toBe('Subscription::Cancel::Other');
    expect(analysis.proposal.skip_rules_append[0]?.rule_type).toBe('tag_filter');
    expect(
      (analysis.proposal.skip_rules_append[0]?.params as { match_any?: string[] })?.match_any,
    ).toEqual(expect.arrayContaining(['non-support-related']));
    expect(analysis.proposal.prompt_hints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('non-support traffic'),
        expect.stringContaining('another brand'),
      ]),
    );
  });
});
