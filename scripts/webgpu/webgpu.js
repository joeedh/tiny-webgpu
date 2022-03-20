import {
  Vector2, Vector3, util, nstructjs,
  Vector4, Matrix4, Quat
} from '../path.ux/pathux.js';
import {preprocess} from './preprocessor.js';
import {
  sizemap, gpuBindIdgen, TypeNameMap,
  TypeSizeMap, WebGPUArgs
} from './webgpu_base.js';

export {ShaderProgram, ShaderProgramBase} from './shaderprogram.js';

export function initWebGPU(args = new WebGPUArgs(), canvas = undefined) {
  args = new WebGPUArgs(args);
  let adapter, device;

  return new Promise((accept, reject) => {
    navigator.gpu.requestAdapter(args).then(adapt => {
      adapter = adapt;

      for (let f of adapter.features) {
        console.log(f);
      }

      console.log(adapter);
      return adapter.requestDevice({
        requiredFeatures: [],
        requiredLimits  : {}
      });
    }).then(dev => {
      device = dev;

      if (!canvas) {
        canvas = document.createElement("canvas");
        document.body.appendChild(canvas);

        canvas.width = canvas.height = 500;

        let dpi = devicePixelRatio;

        canvas.style["width"] = (canvas.width/dpi) + "px";
        canvas.style["height"] = (canvas.height/dpi) + "px";
        canvas.style["position"] = "absolute";
      }

      accept(new WebGPUContext(adapter, device, canvas));
    });
  }).catch(error => console.error(error));
}

export class GPUVertexBuffer {
  constructor(key, type, elemSize, elemBytes = 4) {
    this.type = type;
    this.elemSize = elemSize;
    this.size = 0;
    this.buf = undefined;
    this.elemBytes = elemBytes;
    this.typeName = "float32";
    this.bindLoc = -1;
    this.data = undefined;
    this.key = key;
    this.ready = false;
  }

  async upload(gpu, data = this.data) {
    let size = TypeSizeMap.get(data);

    if (!size) {
      data = new Float32Array(data);
      size = 4;
    }

    this.data = data;
    this.size = data.length/this.elemSize;

    let cls = data.constructor;
    this.elemBytes = size;
    this.typeName = TypeNameMap.get(cls);

    if (!this.buf || data.size !== this.size) {
      if (this.buf) {
        this.buf.destroy();
      }

      this.buf = gpu.device.createBuffer({
        label           : "Vertex:" + this.key,
        size            : data.byteLength,
        usage           : GPUBufferUsage.VERTEX,
        mappedAtCreation: true
      });

      let view = new cls(this.buf.getMappedRange(0, data.byteLength));
      view.set(data);
      this.buf.unmap();

      this.ready = true;
    } else {
      await this.buf.mapAsync(GPUMapMode.WRITE);

      let view = new cls(this.buf.getMappedRange(0, data.byteLength));
      view.set(data);
      this.buf.unmap();

      this.ready = true;
    }
  }
}

export class GPUMesh {
  constructor(type = WebGPUContext.TRIS) {
    this.attrs = new Map();
    this._uniforms = {};
    this.pipelines = new Map();
    this.uniformsUpdate = true;
    this.primitiveType = type;
    this.length = 0;
  }

  get uniforms() {
    this.uniformsUpdate = true;
    return this._uniforms;
  }

  set uniforms(v) {
    this.uniformsUpdate = true;
    this._uniforms = v;
  }

  get isReady() {
    for (let attr of this.attrs.values()) {
      if (!attr.ready) {
        return false;
      }
    }

    return true;
  }

  get(key, type, elemSize) {
    let attr = this.attrs.get(key);

    if (!attr) {
      attr = new GPUVertexBuffer(key, type, elemSize);

      this.attrs.set(key, attr);
    }

    return attr;
  }

  addLayer(key, type, elemSize, data) {
    let attr = this.get(key, type, elemSize);
    attr.data = data;

    return attr;
  }

  async readyWait(gpu) {
    for (let [key, attr] of this.attrs) {
      if (!attr.ready) {
        await attr.upload(gpu);
      }
    }

  }

  calcUniformsKey(uniforms = this.uniforms, digest = new util.HashDigest()) {
    for (let k in this.uniforms) {
      let v = this.uniforms[k];
      digest.add(k);

      if (v instanceof Matrix4) {
        v = v.getAsArray();
      }

      if (Array.isArray(v)) {
        for (let item of v) {
          digest.add(v);
        }
      } else if (typeof v === "number") {
        digest.add(v);
      } else { //textures?
        console.warning("implement me in calcUniformsKey", v);
        digest.add(1);
      }
    }

    return digest.get();
  }

  getBuffers(shader) {
    let ret = [];
    let i = 0;

    for (let [key, attr] of this.attrs) {
      attr.bindLoc = shader.attrLoc(key);

      let attr2 = {
        arrayStride: attr.elemSize*attr.elemBytes,
        attributes : [
          {
            shaderLocation: attr.bindLoc,
            offset        : 0,
            format        : attr.typeName + "x" + attr.elemSize
          }
        ]
      }

      ret.push(attr2);
    }

    return ret;
  }

  checkReady(gpu, shader, uniforms, constants) {
    let ready = this.ready;

    if (!ready && !this.waiting) {
      this.waiting = true;

      this.setup(gpu, shader, uniforms, constants).then(() => {
        window.redraw_all();
      });
    }

    return ready;
  }

  _shaderkey(shader) {
    shader = shader.getBaseShaderSync();
    return "shader" + shader.id;
  }

  drawPre(gpu, shader, uniforms) {
    if (!this.checkReady(gpu, shader, uniforms)) {
      return;
    }

    shader = shader.getBaseShaderSync();
    shader.bindUniforms(gpu, uniforms, true);
  }

  draw(gpu, shader) {
    let pass = gpu.pass;
    let pipeline = this.pipelines.get(this._shaderkey(shader));

    shader = shader.getBaseShaderSync();

    console.log("Draw!", pipeline);

    pass.setPipeline(pipeline.pipeline);
    pass.setBindGroup(0, shader.uniformBlock.bindGroup);

    for (let [key, attr] of this.attrs) {
      pass.setVertexBuffer(attr.bindLoc, attr.buf);
      console.log("BUF", attr);
    }

    let ret = pass.draw(this.length);
    console.log("DRAW", ret);

  }

  async setup(gpu, shader, uniforms, constants = {}) {
    let ukey;

    this.ready = false;
    this.waiting = true;

    await this.readyWait(gpu);

    if (0) {
      if (!uniforms) {
        if (this.uniformsUpdate) {
          this.uniformsUpdate = false;
          ukey = this.uniformsKey = this.calcUniformsKey(this.uniforms);
        } else {
          ukey = this.uniformsKey;
        }
      } else {
        uniforms = Object.assign({}, this.uniforms, uniforms);
        ukey = this.calcUniformsKey(uniforms);
      }
    }

    console.log("PASS", gpu.pass);

    shader = await shader.getBaseShader(gpu);
    let key = "shader" + shader.id;

    console.log(shader);

    let pipeline = this.pipelines.get(key);
    if (!pipeline) {
      let buffers = this.getBuffers(shader);

      console.log("BUFFERS", buffers);

      pipeline = await gpu.createRenderPipeline(shader, shader, this.primitiveType, uniforms, constants, buffers);
      this.pipelines.set(key, pipeline);
    }

    this.waiting = false;
    this.ready = true;
    console.log("READY", this.ready);
  }

  destroy() {
    for (let pipeline of this.pipelines.values()) {
      pipeline.destroy();
    }
  }
}

export class RenderPipeline {
  constructor(pipeline, vshader, fshader, primitiveType, constants, buffers) {
    this.pipeline = pipeline;
    this.vshader = vshader;
    this.fshader = fshader;
    this.primitiveType = primitiveType;
    this.constants = constants;
    this.buffers = buffers;
  }

  destroy() {
    this.pipeline.destroy();
  }
}


export class WebGPUContext {
  constructor(adapter, device, canvas) {
    this.adapter = adapter;
    this.device = device;
    this.context = canvas ? canvas.getContext("webgpu") : undefined;

    this.width = undefined;
    this.height = undefined;
    this.canvas = canvas;

    this.commandEncoder = undefined;

    if (this.context) {
      this.updateSize();
    }
  }

  updateSize() {
    if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
      this.width = this.canvas.width;
      this.height = this.canvas.height;

      console.log("Updating size!");

      this.context.configure({
        device: this.device,
        format: this.context.getPreferredFormat(this.adapter),
        size  : [this.canvas.width, this.canvas.height],
      });
    }
  }

  beginFrame(args) {
    if (this.pass) {
      console.error("last frame wasn't finished");
    }
    this.updateSize();

    this.passView = this.context.getCurrentTexture().createView();

    this.commandEncoder = this.device.createCommandEncoder();
    this.pass = this.beginPass(args);
  }

  endFrame() {
    this.pass.endPass();
    this.device.queue.submit([this.commandEncoder.finish()]);

    this.commandEncoder = undefined;
    this.pass = undefined;
  }

  beginPass(args = {}) {
    args.loadColor = args.loadColor ?? [0.0, 0.0, 0.0, 1.0];

    const renderPassDescriptor = {
      colorAttachments: [
        {
          view     : this.passView,
          loadValue: args.loadColor,
          storeOp  : 'store',
        },
      ],
    };

    return this.commandEncoder.beginRenderPass(renderPassDescriptor);
  }

  endPass(pass) {
    pass.endPass();
  }

  async createRenderPipeline(vshader, fshader, primitiveType, uniforms = {}, constants = {}, vbuffers = []) {
    console.log("FSHADER", fshader);

    let pipeline = this.device.createRenderPipeline({
      layout : fshader.getBaseShaderSync().pipelineLayout,
      vertex: {
        module    : vshader.shaderModule,
        entryPoint: "vertexMain",
        buffers   : vbuffers,
      },

      fragment : {
        module    : fshader.shaderModule,
        entryPoint: "fragmentMain",
        constants,
        targets   : [
          {format: this.context.getPreferredFormat(this.adapter)}
        ]
      },
      primitive: {
        topology: primitiveType
      }
    });

    //pass.setBindGroup(0, shader.uniformBlock.bindGroup);
    return new RenderPipeline(pipeline, vshader, fshader, primitiveType, constants, vbuffers);
  }

}

WebGPUContext.TRIS = 'triangle-list';
