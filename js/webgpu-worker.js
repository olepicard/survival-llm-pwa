/**
 * Dedicated Web Worker for WebLLM / WebGPU Inference
 * Runs WASM tokenization, tensor loading, and WebGPU command encoding off the main UI thread
 * so Android Chrome never freezes or drops frames during prefill and token generation.
 */

import { WebWorkerMLCEngineHandler } from './vendor/web-llm.js';

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (msg) => {
  handler.onmessage(msg);
};
