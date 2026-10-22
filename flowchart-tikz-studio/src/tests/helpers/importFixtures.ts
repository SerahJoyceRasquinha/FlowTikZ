import simplePng from '../fixtures/import/simple.png?b64';
import complexPng from '../fixtures/import/complex.png?b64';
import whitePng from '../fixtures/import/white-shapes.png?b64';
import flowJpg from '../fixtures/import/flow.jpg?b64';
import drawioPng from '../fixtures/import/drawio-embedded.png?b64';
import darkPng from '../fixtures/import/basic-flowchart-dark.png?b64';
import flowchartSvg from '../fixtures/import/flowchart.svg?raw';
import drawioPlainSvg from '../fixtures/import/drawio-export-plain.svg?raw';
import drawioEmbeddedSvg from '../fixtures/import/drawio-embedded.svg?raw';
import flowchartDrawio from '../fixtures/import/flowchart.drawio?raw';
import compressedDrawio from '../fixtures/import/compressed.drawio?raw';
import simpleAnswer from '../fixtures/import/simple.ir.json';
import complexAnswer from '../fixtures/import/complex.ir.json';
import whiteAnswer from '../fixtures/import/white-shapes.ir.json';
import flowAnswer from '../fixtures/import/flow.ir.json';
import { base64ToBytes } from '../../import/binary';

/** Fixture files and the ground-truth IR descriptions that go with them. */

const enc = new TextEncoder();

export const BYTES = {
  simplePng: base64ToBytes(simplePng),
  complexPng: base64ToBytes(complexPng),
  whitePng: base64ToBytes(whitePng),
  flowJpg: base64ToBytes(flowJpg),
  drawioPng: base64ToBytes(drawioPng),
  darkPng: base64ToBytes(darkPng),
  flowchartSvg: enc.encode(flowchartSvg),
  drawioPlainSvg: enc.encode(drawioPlainSvg),
  drawioEmbeddedSvg: enc.encode(drawioEmbeddedSvg),
  flowchartDrawio: enc.encode(flowchartDrawio),
  compressedDrawio: enc.encode(compressedDrawio),
};

export const TEXT = { flowchartSvg, drawioPlainSvg, drawioEmbeddedSvg, flowchartDrawio, compressedDrawio };

export const ANSWERS = {
  simple: simpleAnswer as Record<string, unknown>,
  complex: complexAnswer as Record<string, unknown>,
  white: whiteAnswer as Record<string, unknown>,
  flow: flowAnswer as Record<string, unknown>,
};

export function fileOf(bytes: Uint8Array, name: string, type = ''): File {
  return new File([bytes as BlobPart], name, { type });
}
