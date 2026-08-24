/// <reference lib="webworker" />

import {
  type ReconcileWorkerRequest,
  type ReconcileWorkerResponse,
  reconcileLogseqFolder,
} from './reconciliation.js';

const worker = self as DedicatedWorkerGlobalScope;

worker.addEventListener('message', async (event: MessageEvent<ReconcileWorkerRequest>) => {
  if (event.data.type !== 'reconcile') return;
  try {
    const result = await reconcileLogseqFolder(event.data.root, event.data.cachedPages, {
      force: event.data.force,
      onProgress: (progress) => {
        const response: ReconcileWorkerResponse = { progress, type: 'progress' };
        worker.postMessage(response);
      },
    });
    const response: ReconcileWorkerResponse = { result, type: 'complete' };
    worker.postMessage(response);
  } catch (error) {
    const response: ReconcileWorkerResponse = {
      message: error instanceof Error ? error.message : 'Could not reconcile the graph.',
      type: 'error',
    };
    worker.postMessage(response);
  }
});
