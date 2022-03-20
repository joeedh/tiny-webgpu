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

    let layout = {
      binding   : gpuBindIdgen.next(),
      visibility: ShaderProgram.VERTEX | ShaderProgram.FRAGMENT,
      buffer    : {
        label           : this.id,
        hasDynamicOffset: false, //false is default
        type            : "uniform",
      }
    };

    for (let block of this.bindBlocks) {
      if (block[BindBlock]) {
        continue;
      }

      let layout = {
        binding   : gpuBindIdgen.next(),
        visibility: block.visibility ?? (ShaderProgram.VERTEX | ShaderProgram.FRAGMENT),
        buffer    : {
          label           : block.label,
          hasDynamicOffset: false, //false is default
          type            : "uniform",
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
              size  : v.length,
              type  : block[k],
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

    if (0) {
      this.tempBuffer = gpu.device.createBuffer({
        label           : "Shader Uniform Temp Block",
        size            : this.blockSize,
        mappedAtCreation: true,
        usage           : GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
      });
    } else {
      this.tempBuffer = new ArrayBuffer(this.blockSize);
    }

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
          group      : 0,
          binding    : bind.layout.binding,
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
        v.value = new Float32Array(this.tempBuffer, v.offset, v.size);
        //v.value = this.tempBuffer.getMappedRange(v.offset, v.size*4);
        //v.value = new Float32Array(v.value, 0, v.size);
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

        return true;
      },

      ownKeys(target) {
        return Object.keys(target);
      }
    });
  }

  bind(gpu) {
    /*
    this.tempBuffer = gpu.device.createBuffer({
      label           : "Shader Uniform Temp Block",
      size            : this.blockSize,
      mappedAtCreation: true,
      usage           : GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
    });//*/
  }

  pushCopyCommand(gpu) {
    let buf = this.tempBuffer;
    gpu.device.queue.writeBuffer(this.buffer, 0, buf, 0, this.blockSize);
  }

  unmap(gpu) {
    for (let k in this.lookup) {
      let v = this.lookup[k];

      v.value = undefined;
    }


    //this.tempBuffer.unmap();
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

  bindUniforms(gpu, uniforms, pushCopyCommand = true) {
    this.uniformBlock.bind(gpu);

    for (let k in uniforms) {
      //apply to uniforms Proxy
      this.uniforms[k] = uniforms[k];
    }

    this.uniformBlock.unmap();
    if (pushCopyCommand) {
      this.uniformBlock.pushCopyCommand(gpu);
    }
  }

  async bind(gpu, uniforms, pushUniformsCopy = true) {
    if (!this.ready) {
      await this.init(gpu);
    }

    await this.uniformBlock.bind(gpu);

    for (let k in uniforms) {
      //apply to uniforms Proxy
      this.uniforms[k] = uniforms[k];
    }

    await this.uniformBlock.unmap();

    if (pushUniformsCopy) {
      this.uniformBlock.pushCopyCommand(gpu);
    }
  }

  doUniformBindings(code) {
    let s = '';

    let ublock = this.uniformBlock;
    let blocki = 0;

    let defs = [];
    let ki = 0;

    for (let block of ublock.bindBlocks) {
      console.error(block);
      let binding = block[BindBlock].layout.binding;
      let layout = block[BlockMap];

      s += `struct Uniforms${blocki} {\n`;

      let keys = Object.keys(layout).sort((a, b) => layout[a].offset - layout[b].offset);
      for (let i = 0; i < keys.length; i++) {
        let k = keys[i];
        let v = layout[k];

        let k2 = `_${k}_`;

        s += `  ${k2}: ${v.type}<f32>;\n`;

        let re = new RegExp(`\\b${k}\\b`, "g");

        defs.push([re, `uniforms${blocki}.${k2}`]);
      }
      s += '}\n';

      s += `@group(0) @binding(${binding}) `;
      s += `var<uniform> uniforms${blocki} : Uniforms${blocki};\n`;

      console.error(keys);

      blocki++;
      s += "\n";
    }

    console.error(defs);

    for (let [re, repl] of defs) {
      code = code.replace(re, repl);
    }

    code = s + "\n" + code;

    console.error(code);
    return code;
  }

  doUniformBindings_old(code) {
    let lines = code.split("\n");
    let s = '';
    let ublock = this.uniformBlock;

    for (let l of lines) {
      let l2 = l.trim();

      if (l2.startsWith("UNIFORM")) {
        let i1 = "UNIFORM".length + 1;
        let i2 = l2.search(":");

        let name = l2.slice(i1, i2).trim();
        if (!(name in ublock.lookup)) {
          throw new Error(`Uniform ${name} is not in shader uniform list`);
        }

        let lk = ublock.lookup[name];
        console.log("LOOKUP", name, lk);

        let rest = l2.slice(i1, l2.length).trim();

        let binding = lk.binding;
        l = `@group(${lk.group}) @binding(${binding}) var<uniform> ${rest}`;
      }
      s += l + "\n";
    }

    return s;
  }

  async init(gpu) {
    /* initialize uniforms block */
    await this.uniformBlock.initBindBlocks(gpu);
    await this.uniformBlock.initBindGroups(gpu, this.attributes);

    this.uniforms = this.uniformBlock.getProxy(false);
    await this.uniformBlock.unmap();

    let descr = {
      label           : this.id,
      bindGroupLayouts: [this.uniformBlock.bindGroupLayout]
    };
    this.pipelineLayout = gpu.device.createPipelineLayout(descr);

    console.log("LAYOUT", this.pipelineLayout, descr);

    let code = `
 ${this.declSource}      
 @stage(vertex)
 ${this.vertexSource}
 @stage(fragment)
 ${this.fragmentSource}
      `.trim() + "\n";

    code = this.doUniformBindings(code);

    console.log(code);

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

ShaderProgram.VERTEX = GPUShaderStage.VERTEX;
ShaderProgram.FRAGMENT = GPUShaderStage.FRAGMENT;
ShaderProgram.COMPUTE = GPUShaderStage.COMPUTE;
