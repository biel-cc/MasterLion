import { get as getAtPath, set as setAtPath } from 'es-toolkit/compat';
import { produce } from 'immer';
import type { PartialDeep } from 'type-fest';
import { describe, expect, it } from 'vitest';

import type { AgentItem, LobeAgentConfig } from '@/types/agent';
import { merge } from '@/utils/merge';

import { type AgentMap, AgentWriteLedger, type PendingOptimisticWrite } from './writeLedger';

interface Dispatch {
  data: PartialDeep<LobeAgentConfig>;
  id?: string;
  replacePaths?: string[];
}

/**
 * A stand-in for the store, mirroring `internal_dispatchAgentMap`: it merges the
 * payload, replaces the listed paths, and drives the ledger in the same order the
 * action does. Everything below is expressed through it so the cases read as
 * sequences of requests rather than as ledger bookkeeping.
 */
class Store {
  agentMap: AgentMap;
  readonly ledger = new AgentWriteLedger();

  constructor(agentMap: AgentMap = {}) {
    this.agentMap = agentMap;
  }

  /** A write with no optimistic caller behind it: a fetch, a meta save, a server response. */
  dispatch = ({ data, id = 'a', replacePaths }: Dispatch): number => {
    const ticket = this.ledger.claimWrite(this.agentMap, id, data, replacePaths);

    this.agentMap = produce(this.agentMap, (draft) => {
      draft[id] = draft[id] ? merge(draft[id], data) : (data as PartialDeep<AgentItem>);

      for (const path of replacePaths ?? []) {
        const replacement = getAtPath(data, path);
        if (replacement === undefined) continue;
        setAtPath(draft[id], path, replacement);
      }
    });

    return ticket;
  };

  /** The optimistic half of a request: dispatch, then record what landed. */
  start = (dispatch: Dispatch): PendingOptimisticWrite => {
    const ticket = this.dispatch(dispatch);

    return this.ledger.snapshotWrite(this.agentMap, dispatch.id ?? 'a', ticket);
  };

  fail = (write: PendingOptimisticWrite): void => {
    this.agentMap = this.ledger.rollbackWrite(this.agentMap, write);
  };

  succeed = (write: PendingOptimisticWrite): void => this.ledger.settleWrite(write);

  abort = (write: PendingOptimisticWrite): void => {
    this.agentMap = this.ledger.abandonWrite(this.agentMap, write);
  };

  respond = (
    write: PendingOptimisticWrite,
    data: PartialDeep<LobeAgentConfig>,
    replacePaths?: string[],
  ): void => {
    const projected = this.ledger.projectServerResponse(this.agentMap, write, data, replacePaths);
    if (projected) this.dispatch(projected);
    this.succeed(write);
  };

  agent = (id = 'a'): any => this.agentMap[id];
}

/**
 * The end-to-end behaviour of these rules lives in `action.test.ts`, which drives
 * them through the store. These cases pin the module's own contract: ownership is
 * decided by ticket, a write is undone only when nothing newer stands on it, and
 * undoing one hands its predecessor back the state that predecessor left.
 */
describe('AgentWriteLedger', () => {
  describe('a single write', () => {
    it('restores the previous value of a path nothing newer took', () => {
      const store = new Store({ a: { model: 'gpt-4' } });

      const write = store.start({ data: { model: 'gpt-5' } });
      store.fail(write);

      expect(store.agentMap).toEqual({ a: { model: 'gpt-4' } });
    });

    it('drops the empty husks and the entry the rolled-back write created', () => {
      const store = new Store();

      const write = store.start({
        data: { chatConfig: { runtimeEnv: { workingDirectory: '/tmp' } } } as any,
      });
      store.fail(write);

      expect(store.agentMap).toEqual({});
    });

    it('gives the path up once the agent has left the map', () => {
      const store = new Store({ a: { model: 'gpt-4' } });

      const write = store.start({ data: { model: 'gpt-5' } });
      // The agent is deleted, then re-created under the same id.
      store.agentMap = {};
      store.dispatch({ data: { model: 'unrelated' }, id: 'b' });
      store.agentMap = { ...store.agentMap, a: { model: 'gpt-5' } };

      store.fail(write);

      expect(store.agent()).toEqual({ model: 'gpt-5' });
    });
  });

  describe('two writes on one path', () => {
    it('unwinds to the original when both fail, newest first', () => {
      const store = new Store({ a: { model: 'O' } });

      const older = store.start({ data: { model: 'A' } });
      const newer = store.start({ data: { model: 'B' } });

      // The newer failure returns the path to what it found — the older write's value,
      // which is still the older write's to undo.
      store.fail(newer);
      expect(store.agent()).toEqual({ model: 'A' });

      store.fail(older);
      expect(store.agent()).toEqual({ model: 'O' });
    });

    it('unwinds to the original when both fail, oldest first', () => {
      const store = new Store({ a: { model: 'O' } });

      const older = store.start({ data: { model: 'A' } });
      const newer = store.start({ data: { model: 'B' } });

      // The older one cannot move while the newer write is still standing, so it waits
      // as a tombstone rather than giving its ownership away.
      store.fail(older);
      expect(store.agent()).toEqual({ model: 'B' });

      store.fail(newer);
      expect(store.agent()).toEqual({ model: 'O' });
    });

    it('keeps the newer value when the newer write succeeded and the older then fails', () => {
      const store = new Store({ a: { model: 'O' } });

      const older = store.start({ data: { model: 'A' } });
      const newer = store.start({ data: { model: 'B' } });

      store.succeed(newer);
      store.fail(older);

      expect(store.agent()).toEqual({ model: 'B' });
    });

    it('keeps the newer value while the newer write is still in flight', () => {
      const store = new Store({ a: { model: 'O' } });

      const older = store.start({ data: { model: 'A' } });
      store.start({ data: { model: 'B' } });

      store.fail(older);

      expect(store.agent()).toEqual({ model: 'B' });
    });

    it('keeps a plain dispatch that landed after the failed write', () => {
      const store = new Store({ a: { model: 'O' } });

      const write = store.start({ data: { model: 'A' } });
      store.dispatch({ data: { model: 'B' } });

      store.fail(write);

      expect(store.agent()).toEqual({ model: 'B' });
    });

    it('unwinds past an aborted write, which never reached the server either', () => {
      const store = new Store({ a: { model: 'O' } });

      const aborted = store.start({ data: { model: 'A' } });
      const newer = store.start({ data: { model: 'B' } });

      // An abort leaves the map to the newer write rather than fighting it…
      store.abort(aborted);
      expect(store.agent()).toEqual({ model: 'B' });

      // …but the aborted value is not what the newer failure settles back onto.
      store.fail(newer);
      expect(store.agent()).toEqual({ model: 'O' });
    });

    it('removes an aborted optimistic value when no superseding write exists', () => {
      const store = new Store({ a: { model: 'O' } });

      const write = store.start({ data: { model: 'A' } });
      store.abort(write);

      expect(store.agent()).toEqual({ model: 'O' });
    });

    it('unwinds both failures when the newer one fails before the older abort arrives', () => {
      const store = new Store({ a: { model: 'O' } });

      const older = store.start({ data: { model: 'A' } });
      const newer = store.start({ data: { model: 'B' } });

      store.fail(newer);
      expect(store.agent()).toEqual({ model: 'A' });

      store.abort(older);
      expect(store.agent()).toEqual({ model: 'O' });
    });

    it('does not let an older successful response overwrite a newer success', () => {
      const store = new Store({ a: { model: 'O' } });

      const older = store.start({ data: { model: 'A' } });
      const newer = store.start({ data: { model: 'B' } });

      store.respond(newer, { model: 'B', provider: 'newer-provider' });
      store.respond(older, { model: 'A', provider: 'older-provider' });

      expect(store.agent()).toEqual({ model: 'B', provider: 'newer-provider' });
    });

    it('does not let a newer response roll back an older pending write on another field', () => {
      const store = new Store({ a: { model: 'O', title: 'O' } });

      const modelWrite = store.start({ data: { model: 'A' } });
      const titleWrite = store.start({ data: { title: 'B' } });

      // The title mutation returns a full, stale row while the independent
      // model mutation is still in flight. Only title belongs to this response.
      store.respond(titleWrite, { model: 'O', title: 'B' });
      expect(store.agent()).toEqual({ model: 'A', title: 'B' });

      store.respond(modelWrite, { model: 'A', title: 'O' });
      expect(store.agent()).toEqual({ model: 'A', title: 'B' });
    });

    it('protects a newer leaf success from an older subtree response', () => {
      const store = new Store({ a: { agencyConfig: { env: { FOO: 'O' } } } as any });

      const older = store.start({
        data: { agencyConfig: { env: { FOO: 'A' } } } as any,
        replacePaths: ['agencyConfig.env'],
      });
      const newer = store.start({
        data: { agencyConfig: { env: { FOO: 'B' } } } as any,
      });

      store.respond(newer, { agencyConfig: { env: { FOO: 'B' } } } as any);
      store.respond(older, { agencyConfig: { env: { FOO: 'A', STALE: 'yes' } } } as any, [
        'agencyConfig.env',
      ]);

      expect(store.agent()).toEqual({ agencyConfig: { env: { FOO: 'B' } } });
    });

    it('protects a newer ABA success from an older response', () => {
      const store = new Store({ a: { model: 'O' } });

      const older = store.start({ data: { model: 'A' } });
      const newer = store.start({ data: { model: 'O' } });

      store.respond(newer, { model: 'O' });
      store.respond(older, { model: 'A' });

      expect(store.agent()).toEqual({ model: 'O' });
    });
  });

  describe('writes that cannot be told apart by value', () => {
    it('unwinds a same-value chain to the original', () => {
      const store = new Store({ a: { model: 'O' } });

      const older = store.start({ data: { model: 'A' } });
      const newer = store.start({ data: { model: 'A' } });

      store.fail(newer);
      expect(store.agent()).toEqual({ model: 'A' });

      store.fail(older);
      expect(store.agent()).toEqual({ model: 'O' });
    });

    it('keeps a later write that set the path back to the original value', () => {
      const store = new Store({ a: { model: 'O' } });

      // A → B → A: the map looks untouched, but the last write is the one that owns it.
      const write = store.start({ data: { model: 'A' } });
      store.dispatch({ data: { model: 'O' } });

      store.fail(write);

      expect(store.agent()).toEqual({ model: 'O' });
    });

    it('undoes a same-value write rather than treating it as a no-op', () => {
      const store = new Store({ a: { model: 'O' } });

      const write = store.start({ data: { model: 'O' } });
      store.fail(write);

      expect(store.agent()).toEqual({ model: 'O' });
    });
  });

  describe('overlapping ancestor and descendant paths', () => {
    const subtree = { agencyConfig: { env: { A: '1', B: '2' } } };

    it('unwinds a leaf then the subtree replace around it, newest first', () => {
      const store = new Store({ a: { agencyConfig: { env: { A: 'O', KEPT: 'yes' } } } as any });

      const ancestor = store.start({ data: subtree as any, replacePaths: ['agencyConfig.env'] });
      const descendant = store.start({ data: { agencyConfig: { env: { A: '9' } } } as any });

      store.fail(descendant);
      expect(store.agent().agencyConfig.env).toEqual({ A: '1', B: '2' });

      // The subtree is whole again, so the replace can be undone as one unit —
      // including the entry it removed.
      store.fail(ancestor);
      expect(store.agent().agencyConfig.env).toEqual({ A: 'O', KEPT: 'yes' });
    });

    it('unwinds a leaf then the subtree replace around it, oldest first', () => {
      const store = new Store({ a: { agencyConfig: { env: { A: 'O', KEPT: 'yes' } } } as any });

      const ancestor = store.start({ data: subtree as any, replacePaths: ['agencyConfig.env'] });
      const descendant = store.start({ data: { agencyConfig: { env: { A: '9' } } } as any });

      // The replace cannot be undone as one unit while a later leaf write stands
      // inside it: restoring it would wipe that write.
      store.fail(ancestor);
      expect(store.agent().agencyConfig.env).toEqual({ A: '9', B: '2' });

      // Once the leaf write is undone too, the replace unwinds behind it.
      store.fail(descendant);
      expect(store.agent().agencyConfig.env).toEqual({ A: 'O', KEPT: 'yes' });
    });

    it('keeps a leaf write inside the subtree when it is still standing', () => {
      const store = new Store({ a: { agencyConfig: { env: { A: 'O', KEPT: 'yes' } } } as any });

      const ancestor = store.start({ data: subtree as any, replacePaths: ['agencyConfig.env'] });
      store.dispatch({ data: { agencyConfig: { env: { A: '9' } } } as any });

      store.fail(ancestor);

      // Restoring the subtree would resurrect `KEPT`, which the leaf writer saw gone.
      expect(store.agent().agencyConfig.env).toEqual({ A: '9', B: '2' });
    });

    it('gives a leaf up to a later replace of the subtree around it', () => {
      const store = new Store({ a: { agencyConfig: { env: { A: 'O', KEPT: 'yes' } } } as any });

      const descendant = store.start({ data: { agencyConfig: { env: { A: '9' } } } as any });
      store.dispatch({ data: subtree as any, replacePaths: ['agencyConfig.env'] });

      store.fail(descendant);

      // Undoing the leaf would put `A: 'O'` back inside the winner's subtree.
      expect(store.agent().agencyConfig.env).toEqual({ A: '1', B: '2' });
    });

    it('reveals an older leaf when a newer replace fails, then unwinds the leaf', () => {
      const store = new Store({ a: { agencyConfig: { env: { A: 'O' } } } as any });

      const descendant = store.start({ data: { agencyConfig: { env: { A: '9' } } } as any });
      const ancestor = store.start({ data: subtree as any, replacePaths: ['agencyConfig.env'] });

      // The replace returns to the state it actually found. The older leaf may
      // still succeed, so the newer failure cannot skip past it to the original.
      store.fail(ancestor);
      expect(store.agent().agencyConfig.env).toEqual({ A: '9' });

      // If the older leaf later fails as well, its preserved history unwinds to O.
      store.fail(descendant);
      expect(store.agent().agencyConfig.env).toEqual({ A: 'O' });
    });

    it('preserves a successful older leaf when a newer replace fails', () => {
      const store = new Store({ a: { agencyConfig: { env: { A: 'O' } } } as any });

      const descendant = store.start({ data: { agencyConfig: { env: { A: '9' } } } as any });
      store.succeed(descendant);
      const ancestor = store.start({ data: subtree as any, replacePaths: ['agencyConfig.env'] });

      store.fail(ancestor);

      expect(store.agent().agencyConfig.env).toEqual({ A: '9' });
    });

    it('keeps a successful newer replace when an older leaf fails', () => {
      const store = new Store({ a: { agencyConfig: { env: { A: 'O' } } } as any });

      const descendant = store.start({ data: { agencyConfig: { env: { A: '9' } } } as any });
      const ancestor = store.start({ data: subtree as any, replacePaths: ['agencyConfig.env'] });
      store.succeed(ancestor);

      store.fail(descendant);

      expect(store.agent().agencyConfig.env).toEqual({ A: '1', B: '2' });
    });

    it('rolls back only the paths of a multi-path write that nothing newer took', () => {
      const store = new Store({ a: { chatConfig: { historyCount: 10 }, model: 'O' } as any });

      const write = store.start({
        data: { chatConfig: { historyCount: 99 }, model: 'A' } as any,
      });
      store.dispatch({ data: { model: 'B' } });

      store.fail(write);

      expect(store.agent()).toEqual({ chatConfig: { historyCount: 10 }, model: 'B' });
    });
  });

  describe('lifetime', () => {
    it('drops an agent deleted from the map, and does not follow its id to the next one', () => {
      const store = new Store({ a: { model: 'O' }, b: { model: 'other' } });

      const write = store.start({ data: { model: 'A' } });
      const { a: _deleted, ...remainingAgents } = store.agentMap;
      store.agentMap = remainingAgents;

      // Any dispatch sweeps the records of agents that are gone.
      store.dispatch({ data: { model: 'unrelated' }, id: 'b' });
      store.agentMap = { ...store.agentMap, a: { model: 'recreated' } };

      store.fail(write);

      expect(store.agent()).toEqual({ model: 'recreated' });
    });

    it('holds its answers steady over a long run of writes on one path', () => {
      const store = new Store({ a: { model: 'O' } });

      // Each round settles, so its predecessors become unreachable and are dropped;
      // what the ledger answers must not drift as the history is trimmed behind it.
      for (let round = 0; round < 50; round += 1) {
        store.succeed(store.start({ data: { model: `v${round}` } }));
      }

      const older = store.start({ data: { model: 'A' } });
      const newer = store.start({ data: { model: 'B' } });

      store.fail(newer);
      expect(store.agent()).toEqual({ model: 'A' });

      store.fail(older);
      expect(store.agent()).toEqual({ model: 'v49' });
    });
  });
});
