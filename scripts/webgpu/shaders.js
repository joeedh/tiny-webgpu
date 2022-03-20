import {ShaderProgram} from './webgpu.js';
import {scriptManger} from './preprocessor.js';

export const BasicUniforms = {
  label           : "basic uniforms",

  projectionMatrix: "mat4x4",
  color0          : "vec4",
};

export const Fragments = {
};

export const BasicShader = {
  decl      : `
struct VertexInputs {
   @location(0) co: vec2<f32>;
   @location(1) uv: vec4<f32>;
}

struct VertexOutputs {
  @builtin(position) pos: vec4<f32>;
  @location(0) uv: vec4<f32>;
}

#if 1
#endif
  `,
  vertex    : `
    fn vertexMain(vinput: VertexInputs) -> VertexOutputs {
        var out: VertexOutputs;
         
        out.pos = vec4(vinput.co*2.0 - 1.0, 0.0, 1.0);
        out.uv = vinput.uv;
        
        return out;
    }
  `,
  fragment  : `

    fn fragmentMain(vinput: VertexOutputs) -> @location(0) vec4<f32> {
#ifndef RED
        
        return vec4(color0[0], color2[1], color[2], 1.0);//*0.5 + 0.5*vec4(vinput.uv[0], vinput.uv[1], 0.0, 1.0);
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
    color: "vec4",
    color2: "vec4",
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
