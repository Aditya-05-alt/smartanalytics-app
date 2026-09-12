/**
 * Resolve @/* → src/* for Node ESM scripts.
 * Usage: node --import ./scripts/alias-loader.mjs scripts/….mjs
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./scripts/resolve-alias.mjs', pathToFileURL('./'));
