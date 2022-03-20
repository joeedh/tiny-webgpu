import {util} from '../path.ux/scripts/pathux.js';

export let gpuBindIdgen = new util.IDGen();

export let sizemap = {
  "float": 1,
  "vec2" : 2,
  "vec3" : 3,
  "vec4" : 4,
  "mat4" : 16,
  "mat3" : 9,
  "int"  : 1
};

export const TypeSizeMap = new Map();
TypeSizeMap.set(Int8Array, 1);
TypeSizeMap.set(Uint8Array, 1);
TypeSizeMap.set(Uint8ClampedArray, 1);
TypeSizeMap.set(Int16Array, 2);
TypeSizeMap.set(Uint16Array, 2);
TypeSizeMap.set(Int32Array, 4);
TypeSizeMap.set(Uint32Array, 4);
TypeSizeMap.set(Float32Array, 4);
TypeSizeMap.set(Float64Array, 8);

export const TypeNameMap = new Map();
TypeNameMap.set(Int8Array, "int8");
TypeNameMap.set(Uint8Array, "uint8");
TypeNameMap.set(Uint8ClampedArray, "uint8");
TypeNameMap.set(Int16Array, "int16");
TypeNameMap.set(Uint16Array, "uint16");
TypeNameMap.set(Int32Array, "int32");
TypeNameMap.set(Uint32Array, "uint32");
TypeNameMap.set(Float32Array, "float32");
TypeNameMap.set(Float64Array, "float64");

export class WebGPUArgs {
  constructor(args = {}) {
    this.powerPreference = "high-performance";

    for (let k in args) {
      this[k] = args[k];
    }
  }
}
