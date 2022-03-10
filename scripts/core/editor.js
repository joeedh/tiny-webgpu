import {simple, nstructjs, util, math, Vector2, UIBase, Icons, KeyMap, haveModal, ToolOp} from '../path.ux/pathux.js';
import {getElemColor} from './mesh.js';
import {MeshEditor} from './mesh_editor.js';

export class LoadDefaultsOp extends ToolOp {
  static tooldef() {
    return {
      uiname  : "Load Defaults",
      toolpath: "app.load_defaults",
      inputs  : {},
      outputs : {}
    }
  }

  exec(ctx) {
    ctx.state.createNewFile(true);
    window.redraw_all();
  }
}

ToolOp.register(LoadDefaultsOp);

export class Workspace extends simple.Editor {
  constructor() {
    super();

    this.canvas = document.createElement("canvas");
    this.g = this.canvas.getContext("2d");

    this.mpos = new Vector2();

    this.toolmode = new MeshEditor();
    this.shadow.appendChild(this.canvas);

    this.keymap = new KeyMap();

    let eventBad = (e) => {
      if (haveModal()) {
        return true;
      }

      let elem = this.ctx.screen.pickElement(e.x, e.y);
      return elem && elem !== this && elem !== this.canvas;
    }

    this.addEventListener("pointerover", (e) => {
      let mpos = this.getLocalMouse(e.x, e.y);
      this.mpos.load(mpos);
    });

    this.addEventListener("pointerdown", (e) => {
      let mpos = this.getLocalMouse(e.x, e.y);
      this.mpos.load(mpos);

      if (eventBad(e)) {
        return;
      }

      this.toolmode.on_mousedown(mpos[0], mpos[1], e);
    });

    this.addEventListener("pointermove", (e) => {
      let mpos = this.getLocalMouse(e.x, e.y);
      this.mpos.load(mpos);

      if (eventBad(e)) {
        return;
      }

      this.toolmode.on_mousemove(mpos[0], mpos[1], e);
    });

    this.addEventListener("pointerup", (e) => {
      let mpos = this.getLocalMouse(e.x, e.y);
      this.mpos.load(mpos);

      if (eventBad(e)) {
        return;
      }

      this.toolmode.on_mouseup(mpos[0], mpos[1], e);
    });
  }

  static defineAPI(api, st) {

  }

  static define() {
    return {
      tagname : "workspace-editor-x",
      areaname: "workspace-editor-x",
      uiname  : "Workspace",
    }
  }

  getGlobalMouse(x, y) {
    let mpos = new Vector2();
    let r = this.canvas.getBoundingClientRect();

    let dpi = UIBase.getDPI();

    mpos[0] = x/dpi + r.x;
    mpos[1] = y/dpi + r.y;

    return mpos;
  }

  getLocalMouse(x, y) {
    let mpos = new Vector2();
    let r = this.canvas.getBoundingClientRect();

    let dpi = UIBase.getDPI();

    mpos[0] = (x - r.x)*dpi;
    mpos[1] = (y - r.y)*dpi;

    return mpos;
  }

  getKeyMaps() {
    return [this.keymap, this.toolmode.keymap];
  }

  init() {
    super.init();

    this.toolmode.ctx = this.ctx;

    let sidebar = this.makeSideBar();

    let header = this.header;
    let row;

    row = header.row();
    row.iconbutton(Icons.UNDO, "Undo", () => {
      this.ctx.toolstack.undo();
    });
    row.iconbutton(Icons.REDO, "Redo", () => {
      this.ctx.toolstack.redo();
    });

    row.button("Save Defaults", () => {
      _appstate.saveStartupFile();
    })

    row.tool("app.load_defaults()");

    let tab;
    tab = sidebar.tab("Options");

    let props = UIBase.createElement("props-bag-editor-x");
    props.setAttribute("datapath", "properties");

    tab.add(props);
  }

  draw() {
    if (!this.ctx) {
      return;
    }

    let canvas = this.canvas;

    let dpi = UIBase.getDPI();
    let w = ~~(this.size[0]*dpi);
    let h = ~~(this.size[1]*dpi) - 50*dpi;

    if (w !== canvas.width || h !== canvas.height) {
      canvas.width = w;
      canvas.height = h;

      canvas.style["width"] = "" + (w/dpi) + "px";
      canvas.style["height"] = "" + (h/dpi) + "px";
    }

    this.g.clearRect(0, 0, canvas.width, canvas.height);
    console.log("draw!");

    this.toolmode.draw(this.ctx, this.canvas, this.g);
  }

  setCSS() {
    this.canvas.style["position"] = "absolute";
  }
}

Workspace.STRUCT = nstructjs.inherit(Workspace, simple.Editor, "Workspace") + `
}`;
simple.Editor.register(Workspace);

