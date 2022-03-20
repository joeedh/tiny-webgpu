import {
  simple, util, Vector2, Vector3, Matrix4, math, ToolOp, PropTypes, NumberConstraints, TextBoxBase
} from '../path.ux/pathux.js';

import './editor.js';
import {Mesh, MeshTypes} from './mesh.js';
import {Workspace} from './editor.js';
import {FileArgs} from '../path.ux/scripts/simple/file.js';
import {PropertiesBag} from './property_templ.js';
import {Context} from './context.js';
import {initWebGPU} from '../webgpu/webgpu.js';
import {loadShaders} from '../webgpu/shaders.js';

import '../webgpu/preprocessor.js';

export const STARTUP_FILE_KEY = "_startup_file_webgpu";

export const Properties = {
  steps  : {type: "int", value: 1, min: 0, max: 10, slideSpeed: 5},
  boolVal: {type: "bool", value: true},
};

window.addEventListener("contextmenu", (e) => {
  console.log(e);

  if (window._appstate && _appstate.screen) {
    let elem = _appstate.screen.pickElement(e.x, e.y);

    if (elem instanceof TextBoxBase || elem.tagName === "INPUT") {
      return;
    }
  }
  e.preventDefault();
});


export class App extends simple.AppState {
  constructor() {
    super(Context);

    this.gpu = undefined;
    this.gpuReady = false;

    this.mesh = undefined;
    this.properties = undefined;

    this.createNewFile(true);

    this.saveFilesInJSON = true;
  }

  createNewFile(noReset = false) {
    if (!noReset) {
      this.reset();
      this.makeScreen();
    }

    this.properties = new PropertiesBag(Properties);

    this.mesh = new Mesh();
    let s = 50;
    let d = 200;
    let v1 = this.mesh.makeVertex([s, s, 0]);
    let v2 = this.mesh.makeVertex([s, s + d, 0]);
    let v3 = this.mesh.makeVertex([s + d, s + d, 0]);
    let v4 = this.mesh.makeVertex([s + d, s, 0]);

    this.mesh.makeFace([v1, v2, v3, v4]);
  }

  saveStartupFile() {
    this.saveFile().then((json) => {
      json = JSON.stringify(json);

      localStorage[STARTUP_FILE_KEY] = json;
      console.log("Saved startup file", (json.length/1024.0).toFixed(2) + "kb");
    });
  }

  loadStartupFile() {
    if (!(STARTUP_FILE_KEY in localStorage)) {
      return;
    }

    try {
      let json = JSON.parse(localStorage[STARTUP_FILE_KEY]);
      this.loadFile(json);
    } catch (error) {
      util.print_stack(error);
      console.warn("Failed to load startup file");
    }
  }

  saveFileSync(objects, args = {}) {
    if (args.useJSON === undefined) {
      args.useJSON = true;
    }

    return super.saveFileSync([
      this.mesh, this.properties
    ], args);
  }

  saveFile(args = {}) {
    return new Promise((accept, reject) => {
      accept(this.saveFileSync([this.mesh, this.properties], args));
    });
  }

  loadFileSync(data, args = {}) {
    if (args.useJSON === undefined) {
      args.useJSON = true;
    }

    let file = super.loadFileSync(data, args);
    console.log(file.objects);

    this.mesh = file.objects[0];
    this.properties = file.objects[1] ?? this.properties;

    this.properties.patchTemplate(Properties);

    window.redraw_all();

    return file;
  }

  initGPU(gpu) {
    this.gpuReady = true;
    this.gpu = gpu;
    loadShaders(gpu);
  }

  loadFile(data, args = {}) {
    return new Promise((accept, reject) => {
      accept(this.loadFileSync(data, args));
    });
  }

  start() {
    super.start({
      DEBUG: {
        modalEvents: true
      }
    });

    this.loadStartupFile();
  }
}

export function start() {
  console.log("start!");

  initWebGPU({}).then((gpu) => {
    window._gpu = gpu;
    _appstate.initGPU(gpu);
    window.redraw_all();
  })

  let animreq;

  function dodraw() {
    if (!window._appstate || !window._appstate.screen) {
      return;
    }

    let screen = _appstate.screen;
    let gpu = !_appstate.gpuReady ? undefined : _appstate.gpu;

    if (gpu) {
      for (let sarea of screen.sareas) {
        if (gpu && sarea.area.drawGPU) {
          try {
            sarea.area.drawGPUPre(gpu);
          } catch (error) {
            console.error("ERROR", error);
            util.print_stack(error);
          }
        }
      }

      gpu.beginFrame({loadColor: [1, 0.8, 0.7, 1]});
    }

    for (let sarea of screen.sareas) {
      if (sarea.area.draw) {
        try {
          sarea.area.draw();
        } catch (error) {
          util.print_stack(error);
        }
      }

      if (gpu && sarea.area.drawGPU) {
        try {
          sarea.area.drawGPU(gpu);
        } catch (error) {
          console.error("ERROR", error);
          util.print_stack(error);
        }
      }
    }

    if (gpu) {
      gpu.endFrame();

      console.log("END", gpu.commandEncoder, gpu.pass);
    }
  };

  function f() {
    if (1) {
      animreq = undefined;
      dodraw();
    } else {
      dodraw().then(() => {
        animreq = undefined;
      }).catch((error) => {
        console.error(error);
        animreq = undefined;
      });
    }
  }


  window.redraw_all = function () {
    if (animreq !== undefined) {
      return;
    }

    animreq = requestAnimationFrame(f);
  }

  window._appstate = new App();
  _appstate.start();

  window.redraw_all();
}