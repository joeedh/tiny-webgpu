import config from '../config/config.js';

import {
  BoolProperty, EnumProperty, FlagProperty, FloatProperty, IntProperty, ToolOp
} from '../path.ux/scripts/pathux.js';
import {MeshFlags, MeshTypes} from './mesh.js';
import {SelToolModes} from './mesh_ops.js';


export class SelectOpBase extends ToolOp {
  static tooldef() {
    return {
      inputs: {
        mode   : new EnumProperty(SelToolModes.AUTO, SelToolModes),
        selMask: new FlagProperty(1 | 2 | 4 | 8 | 16, MeshTypes)
      }
    }
  }

  static create(ctx, args) {
    let tool = super.create(ctx, args);

    if (!("selMask" in args)) {
      tool.inputs.selMask.setValue(ctx.selMask);
    }

    return tool;
  }

  undoPre(ctx) {
    this._undo = [];

    let mesh = ctx.mesh;
    let mask = this.inputs.selMask.getValue();

    for (let list of mesh.getElists()) {
      let data = {
        elems    : [],
        type     : list.type,
        active   : list.active ? list.active.eid : -1,
        highlight: list.highlight ? list.highlight.eid : -1
      };
      this._undo.push(data);

      data = data.elems;

      if (!(list.type & mask)) {
        continue;
      }

      for (let e of list) {
        data.push(e.eid);
        data.push(e.flag);
      }
    }
  }

  undo(ctx) {
    let mesh = ctx.mesh;
    let eidMap = mesh.eidMap;

    for (let list of this._undo) {
      let elist = mesh.elists[list.type];

      elist.active = eidMap.get(list.active);
      elist.highlight = eidMap.get(list.highlight);

      let data = list.elems;
      for (let i = 0; i < data.length; i += 2) {
        let eid = data[i], state = data[i + 1];

        let elem = eidMap.get(eid);
        if (!elem) {
          console.error("Missing mesh element " + eid + ":" + list.tyoe);
          continue;
        }

        if (state === elem.flag) {
          continue;
        }

        elist.setSelect(elem, state & MeshFlags.SELECT);
      }
    }

    window.redraw_all();
  }

  execPost(ctx) {
    window.redraw_all();
  }
}

export class SelectOneOp extends SelectOpBase {
  static tooldef() {
    return {
      uiname  : "Select One",
      toolpath: "mesh.select_one",
      inputs  : ToolOp.inherit({
        elemEid  : new IntProperty(),
        flush    : new BoolProperty(true),
        setActive: new BoolProperty(true),
        unique   : new BoolProperty(true)
      })
    }
  }

  static invoke(ctx, args) {
    let tool = super.invoke(ctx, args);

    if (!("selMask" in args)) {
      tool.inputs.selMask.setValue(ctx.selMask);
    }

    return tool;
  }

  exec(ctx) {
    let mesh = ctx.mesh;
    let {mode, elemEid, flush, setActive, unique, selMask} = this.getInputs();

    let elem = mesh.eidMap.get(elemEid);

    console.log("unique", unique, flush, setActive, elemEid, mode, elem);

    if (unique) {
      mesh.selectNone();
    }

    if (mode === SelToolModes.ADD || mode === SelToolModes.AUTO) {
      mesh.setSelect(elem, mode !== SelToolModes.SUB);
    }

    if (setActive) {
      mesh.setActive(elem);
    }

    if (flush) {
      mesh.selectFlush(selMask);
    }
  }
}

ToolOp.register(SelectOneOp);

export class ToggleSelectOp extends SelectOpBase {
  static tooldef() {
    return {
      uiname  : "Select All/None",
      toolpath: "mesh.toggle_select_all",
      inputs  : ToolOp.inherit({
        setActive: new BoolProperty(false)
      }),
      outputs : ToolOp.inherit({}),
    }
  }

  exec(ctx) {
    let mesh = ctx.mesh;
    let {setActive, mode, selMask} = this.getInputs();

    let hasActive;

    if (mode === SelToolModes.AUTO) {
      mode = SelToolModes.ADD;

      for (let elist of mesh.getElists()) {
        if (!(elist.type & selMask)) {
          continue;
        }

        if (elist.active) {
          hasActive = true;
        }

        if (elist.selected.length > 0) {
          mode = SelToolModes.SUB;
        }
      }
    }

    if (setActive && mode === SelToolModes.SUB) {
      mesh.setActive(undefined);
    } else if (setActive && mode === SelToolModes.ADD) {
      setActive = setActive && !hasActive;
    }

    console.log(setActive, selMask, mode);

    for (let elist of mesh.getElists()) {
      if (!(elist.type & selMask)) {
        continue;
      }

      let setActive2 = setActive;

      for (let elem of elist.editable) {
        elist.setSelect(elem, mode === SelToolModes.ADD);

        if (setActive2) {
          mesh.setActive(elem);
          setActive2 = false;
        }
      }
    }

    mesh.selectFlush(selMask);
  }
}

ToolOp.register(ToggleSelectOp);

export class SelectLinked extends SelectOpBase {
  static tooldef() {
    return {
      uiname  : "Select Linked",
      toolpath: "mesh.select_linked",
      inputs  : ToolOp.inherit({
        pick    : new BoolProperty(false),
        elemEid : new IntProperty(-1),
        onlyElem: new BoolProperty(false),
      }),
      outputs : ToolOp.inherit({}),
    }
  }

  static invoke(ctx, args) {
    let tool = super.invoke(ctx, args);

    if (tool.inputs.pick.getValue()) {
      let workspace = ctx.workspace;
      let elem = workspace.toolmode.pick(workspace.mpos[0], workspace.mpos[1], tool.inputs.selMask.getValue());

      if (elem) {
        switch (elem.type) {
          case MeshTypes.HANDLE:
            elem = elem.owner.v1;
            break;
          case MeshTypes.EDGE:
            elem = elem.v1;
            break;
          case MeshTypes.FACE:
            elem = elem.lists[0].l.v;
            break;
          case MeshTypes.LOOP:
            elem = elem.v;
            break;
        }

        tool.inputs.elemEid.setValue(elem.eid);
        tool.inputs.onlyElem.setValue(true);
      }
    }

    return tool;
  }

  exec(ctx) {
    let visit = new WeakSet();
    let stack = [];
    let mesh = ctx.mesh;
    let {selMask, mode, pick, onlyElem, elemEid} = this.getInputs();

    let vs;

    if (onlyElem && elemEid >= 0) {
      let v = mesh.eidMap.get(elemEid);

      if (!v || v.type !== MeshTypes.VERTEX) {
        console.warn("Invalid element " + elemEid + "; got", v);
        return;
      } else {
        vs = new Set([v]);
      }
    } else {
      vs = new Set(mesh.verts.selected.editable);
    }

    for (let v of vs) {
      if (visit.has(v)) {
        continue;
      }

      stack.length = 0;
      stack.push(v);
      visit.add(v);

      while (stack.length > 0) {
        let v2 = stack.pop();

        mesh.setSelect(v2, mode === SelToolModes.ADD);

        for (let e of v2.edges) {
          let v3 = e.otherVertex(v2);

          if (!visit.has(v3)) {
            visit.add(v3);
            stack.push(v3);
          }
        }
      }
    }

    mesh.selectFlush(selMask);
  }
}

ToolOp.register(SelectLinked);
