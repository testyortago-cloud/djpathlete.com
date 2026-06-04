// Type shim: @vladmandic/human ships no .d.ts for the dist/human.node-wasm.js
// subpath (only the default dist/human.node.js path carries types). We import the
// node-wasm build at runtime to avoid the native @tensorflow/tfjs-node require;
// detect-face.ts narrows the default export to the Human constructor using the
// package's main types. This declaration just lets the module resolve under tsc.
declare module "@vladmandic/human/dist/human.node-wasm.js" {
  const mod: unknown
  export default mod
}
