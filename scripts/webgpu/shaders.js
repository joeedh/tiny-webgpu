import {ShaderProgram} from './webgpu.js';
import {scriptManger} from './preprocessor.js';

export const BasicUniforms = {
  label           : "basic uniforms",
  projectionMatrix: "mat4",
};

export const Fragments = {
};

export const BasicShader = {
  decl      : `
#if 1
#endif
    var<private> pos : array<vec2<f32>, 3> = array<vec2<f32>, 3>(
        vec2(-1.0, -1.0), vec2(-1.0, 3.0), vec2(3.0, -1.0));
  `,
  vertex    : `
    fn vertexMain(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4<f32> {
        return vec4(pos[vertexIndex], 1.0, 1.0);
    }
  `,
  fragment  : `
    fn fragmentMain() -> @location(0) vec4<f32> {
#ifndef RED
        return vec4(1.0, 1.0, 0.5, 1.0);
#else
        return vec4(1.0, 0.0, 0.0, 1.0);
#endif
    }
  `,
  attributes: {
    co : 2,
    uv : 2,
  },
  uniforms  : {
    label: "BasicShader uniforms",
    BasicUniforms,
    color: "vec4"
  },
  defines   : {}
};

export const ShaderDef = {
  BasicShader
};

export const Shaders = {};

export function loadShaders(gpu) {
  for (let k in Fragments) {
    scriptManger.add(Fragments[k], k);
  }

  for (let k in ShaderDef) {
    Shaders[k] = new ShaderProgram(ShaderDef[k], k);
    //Shaders[k].init(gpu);
  }
}
