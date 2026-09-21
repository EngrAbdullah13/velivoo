import test from 'node:test';
import assert from 'node:assert/strict';
import { phase3JobId, type Phase3Job } from '../packages/queue/src/bullmq/phase3-job-queue.js';

const workspaceId='11111111-1111-1111-1111-111111111111';
const transitionId='22222222-2222-2222-2222-222222222222';

function audienceJob(eventId?:string):Phase3Job{
 return {
  type:'phase3.audience.transition',
  workspaceId,
  transitionId,
  audienceType:'list',
  eventId
 };
}

test('audience queue jobs are idempotent per immutable outbox event',()=>{
 const eventId='33333333-3333-3333-3333-333333333333';
 assert.equal(phase3JobId(audienceJob(eventId)),phase3JobId(audienceJob(eventId)));
});

test('rejoining the same list membership creates a distinct queue job',()=>{
 const first=phase3JobId(audienceJob('33333333-3333-3333-3333-333333333333'));
 const second=phase3JobId(audienceJob('44444444-4444-4444-4444-444444444444'));
 assert.notEqual(first,second);
});

test('legacy audience jobs retain transition-based idempotency',()=>{
 assert.equal(
  phase3JobId(audienceJob()),
  `phase3.audience.transition/${workspaceId}/list/${transitionId}`
 );
});
