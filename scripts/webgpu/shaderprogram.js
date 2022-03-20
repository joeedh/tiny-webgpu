import {Matrix4, util} from '../path.ux/scripts/pathux.js';
import {preprocess} from './preprocessor.js';

export const BindBlock = Symbol("BindBlock");
export const BlockMap = Symbol("BlockMap");

import {sizemap, gpuBindIdgen} from './webgpu_base.js';

export class UniformsBlock {
  constructor(def) {
    this.label = def.label || "Shader Uniform Bind Group";
    this.bindBlocks = [];
    this.visibility = undefined;

    this.tempBuffer = undefined;

    this.lookup = {};

    let block = {};

    this.blockSize = 0;

    for (let k in def) {
      if (typeof k === "symbol") {
        continue;
      }

      let v = def[k];

      if (typeof v === "object" && v.constructor === Object) {
        this.bindBlocks.push(v);
      } else {
        block[k] = def[k];
      }

      if (!block.label) {
        block.label = k;
      }
    }

    if (Reflect.ownKeys(block).length > 0) {
      this.bindBlocks.push(block);
    }
  }

  async initBindBlocks(gpu) {
    this.blockSize = 0;

    for (let block of this.bindBlocks) {
      if (block[BindBlock]) {
        continue;
      }

      let layout = {
        binding   : gpuBindIdgen.next(),
        visibility: block.visibility ?? (ShaderProgram.VERTEX | ShaderProgram.FRAGMENT),
        buffer    : {
          hasDynamicOffset: false, //false is default
          type            : "uniform",
          label           : block.label,
        }
      };

      let map = block[BlockMap] = {};
      let cur = 0;

      for (let k in block) {
        if (typeof k === "symbol" || k === "label") {
          continue;
        }

        let v = block[k];

        if (!(v instanceof Texture)) {
          if (typeof v === "string" && v in sizemap) {
            v = new Array(sizemap[v]);
            v.fill(0);
          } else if (v instanceof Matrix4) {
            v = v.toArray();
          }

          if (Array.isArray(v)) {
            map[k] = {
              offset: cur*4,
              size  : v.length
            };

            cur += v.length;
          }
        }
      }

      layout.buffer.minBindingSize = cur*4;

      block[BindBlock] = {
        layout,
        bind: gpu.device.createBindGroupLayout({
          entries: [layout]
        }),
        size: cur*4
      }

      this.blockSize += cur*4;

      let align = gpu.device.limits.minUniformBufferOffsetAlignment;

      let rem = this.blockSize%align;
      if (rem) {
        this.blockSize += align - rem;
      }


      console.log("BIND BLOCK", block[BindBlock]);
    }
  }

  async initBindGroups(gpu, attrs) {
    let align = gpu.device.limits.minUniformBufferOffsetAlignment;

    let entries = [];
    let layout = {
      label  : this.label,
      entries: [],
    };

    for (let k in attrs) {
      let entry = {
        label     : this.label + ":" + k,
        binding   : gpuBindIdgen.next(),
        visibility: (ShaderProgram.VERTEX | ShaderProgram.FRAGMENT),
        buffer    : {
          label: this.label + ":attr:" + k,
          type : "vertex"
        }
      }
    }
    let offset = 0;

    console.log("Block Size:", this.blockSize);

    let buffer = this.buffer = gpu.device.createBuffer({
      label           : "Shader Uniform Block",
      size            : this.blockSize,
      mappedAtCreation: true,
      usage           : GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.tempBuffer = gpu.device.createBuffer({
      label           : "Shader Uniform Temp Block",
      size            : this.blockSize,
      mappedAtCreation: true,
      usage           : GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
    });

    for (let block of this.bindBlocks) {
      let bind = block[BindBlock];

      let entry = {
        binding : bind.layout.binding,
        resource: {
          buffer,
          size: bind.size,
          offset,
        }
      };

      let map = block[BlockMap];
      for (let k in map) {
        this.lookup[k] = {
          offset     : offset + map[k].offset,
          size       : map[k].size,
          cachedValue: new Array(map[k].size),
          type       : "float",
        };

        this.lookup[k].cachedValue.fill(0);
      }

      console.log(bind);

      layout.entries.push(bind.layout);
      entries.push(entry);

      offset += bind.size;

      let rem = offset%align;

      if (rem) {
        offset += align - rem;
      }
    }

    layout = this.bindGroupLayout = gpu.device.createBindGroupLayout(layout);

    console.log("LAYOUT", layout);

    this.bindGroup = gpu.device.createBindGroup({
      label: this.label,
      layout,
      entries
    });

    console.log(this.bindGroup, this.buffer);

    for (let k in this.lookup) {
      let v = this.lookup[k];

      if (v.type === "float") {
        v.value = this.buffer.getMappedRange(v.offset, v.size*4);
        v.value = new Float32Array(v.value, 0, v.size);
      }
    }

    this.buffer.unmap();
    console.log(this);
  }

  getProxy(ignoreErrors = false) {
    let checkMapping = (key) => {
      let v = this.lookup[key];
      if (!v.value) {
        v.value = this.tempBuffer.getMappedRange(v.offset, v.size*4);
        v.value = new Float32Array(v.value, 0, v.size*4);
      }
    }

    let tmp = [0];

    return new Proxy(this.lookup, {
      get(target, key, recv) {
        if (!(key in target)) {
          if (ignoreErrors) {
            return;
          } else {
            throw new Error("Unknown uniform " + key);
          }
        }


        checkMapping(key);
        return target[key].cachedValue;
      },
      set(target, key, value, recv) {
        if (!(key in target)) {
          if (ignoreErrors) {
            return;
          } else {
            throw new Error("Unknown uniform " + key);
          }
        }

        if (typeof value === "number") {
          tmp[0] = value;
          value = tmp;
        }

        checkMapping(key);
        target[key].cachedValue.set(value);
        target[key].value.set(value);
      },
      ownKeys(target) {
        return Object.keys(target);
      }
    });
  }

  bind() {
    return this.tempBuffer.mapAsync(GPUMapMode.WRITE, 0, this.blockSize);
  }

  pushCopyCommand(gpu) {
    if (gpu.commandEncoder) {
      gpu.commandEncoder.copyBufferToBuffer(this.tempBuffer, 0, this.buffer, 0, this.blockSize);
    }
  }

  async unmap(gpu) {
    for (let k in this.lookup) {
      let v = this.lookup[k];

      v.value = undefined;
    }

    this.tempBuffer.unmap();
  }
}

export class Texture {
  constructor() {
    this.gpu = undefined;
    this.tex = undefined;
  }
}

let shader_idgen = 0;
let _temp_digest = new util.HashDigest();

export class ShaderProgram {
  constructor(sdef) {
    this.program = undefined;
    this.defines = {};
    this.defKey = undefined;
    this.defShaders = new Map();
    this.sdef = sdef;
    this.gpu = undefined;
  }

  get shaderModule() {
    return this.defShaders.get(this.defKey).shaderModule;
  }

  getBaseShaderSync() {
    return this.defShaders.get(this.defKey);
  }

  async getBaseShader(gpu) {
    await this.check(gpu);

    return this.defShaders.get(this.defKey);
  }

  async check(gpu) {
    this.gpu = gpu;

    let regen = !this.program;

    let defkey = this.calcDefKey();
    regen = regen || defkey !== this.defKey;

    if (regen) {
      await this.init(gpu);
    }
  }

  async bind(gpu, uniforms) {
    await this.check(gpu);

    await this.defShaders.get(this.defKey).bind(gpu, uniforms);
  }

  calcDefKey(digest = _temp_digest.reset()) {
    for (let k in this.defines) {
      let v = this.defines[k];

      digest.add(k);

      if (v !== null) {
        digest.add(v);
      }
    }

    return digest.get();
  }

  async init(gpu) {
    this.gpu = gpu;
    this.defKey = this.calcDefKey();

    if (this.defShaders.has(this.defKey)) {
      return; //already have shader
    }

    let sdef = Object.assign({}, this.sdef);

    let s = '';
    for (let k in this.defines) {
      let v = this.defines[k];

      s += "#define " + this.defines[k];
      if (v !== null) {
        s += " " + v;
      }

      s += "\n";
    }

    sdef.decl = preprocess(s + (sdef.decl ?? ""));
    sdef.vertex = preprocess(s + sdef.vertex);
    sdef.fragment = preprocess(s + sdef.fragment);

    let shader = new ShaderProgramBase(sdef, "Shader" + this.defKey);
    await shader.init(gpu);

    this.defShaders.set(this.defKey, shader);
  }
}

export class ShaderProgramBase {
  constructor(sdef = {}, label = "Shader") {
    this.vertexSource = sdef.vertex;
    this.id = "" + label + (shader_idgen++);
    this.fragmentSource = sdef.fragment;
    this.declSource = sdef.decl;
    this.attributes = Object.assign({}, sdef.attributes);
    this.uniformDef = {};
    this.label = label + (shader_idgen++);
    this.uniformBlock = new UniformsBlock(sdef.uniforms);

    this.attrLocs = {};

    let ai = 0;
    for (let key in sdef.attributes) {
      this.attrLocs[key] = ai++;
    }

    this.ready = false;
  }

  getBaseShaderSync() {
    return this;
  }

  attrLoc(key) {
    return this.attrLocs[key];
  }

  async bind(gpu, uniforms, pushUniformsCopy=true) {
    if (!this.ready) {
      await this.init(gpu);
    }

    await this.uniformBlock.bind();

    for (let k in uniforms) {
      //apply to uniforms Proxy
      this.uniforms[k] = uniforms[k];
    }

    await this.uniformBlock.unmap();

    if (pushUniformsCopy) {
      this.uniformBlock.pushCopyCommand(gpu);
    }
  }

  async init(gpu) {
    /* initialize uniforms block */
    await this.uniformBlock.initBindBlocks(gpu);
    await this.uniformBlock.initBindGroups(gpu, this.attributes);

    this.uniforms = this.uniformBlock.getProxy(false);
    await this.uniformBlock.unmap();

    this.pipelineLayout = gpu.device.createPipelineLayout({
      label : this.id,
      bindGroupLayouts: [this.uniformBlock.bindGroupLayout]
    });

    let code = `
 ${this.declSource}      
 @stage(vertex)
 ${this.vertexSource}
 @stage(fragment)
 ${this.fragmentSource}
      `.trim() + "\n";

    this.shaderModule = gpu.device.createShaderModule({
      label: this.label,
      code,
      hints: this.pipelineLayout,
    });

    let info = await this.shaderModule.compilationInfo();
    console.log("INFO", info);

    if (info.messages.length === 0) {
      this.ready = true;
    }

    console.log("MOD", this.shaderModule);
  }
}

ShaderProgram.VERTEX = 0x1;
ShaderProgram.FRAGMENT = 0x2;
ShaderProgram.COMPUTE = 0x4;
