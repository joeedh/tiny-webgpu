import config from '../config/config.js';

import {
  Vector2, Vector3, Vector4, util, math,
  nstructjs, Matrix4, Quat, ToolOp,
  FloatProperty, BoolProperty, IntProperty,
  EnumProperty, FlagProperty
} from '../path.ux/pathux.js';
import {Mesh, MeshFlags, MeshTypes} from './mesh.js';

export let SelToolModes = {
  ADD : 0,
  SUB : 1,
  AUTO: 2
};

function saveUndoMesh(mesh) {
  let data = [];
  nstructjs.writeObject(data, mesh);

  return new DataView(new Uint8Array(data).buffer);
}

function loadUndoMesh(mesh, data) {
  let mesh2 = nstructjs.readObject(data, Mesh);

  for (let k in mesh2) {
    mesh[k] = mesh2[k];
  }

  window.redraw_all();
}

export class MeshOp extends ToolOp {
  undoPre(ctx) {
    this._undo = saveUndoMesh(ctx.mesh);
  }

  undo(ctx) {
    loadUndoMesh(ctx.mesh, this._undo);
  }

  execPost(ctx) {
    window.redraw_all();
  }
}

export class SplitEdgeOp extends MeshOp {
  static tooldef() {
    return {
      uiname  : "Split Edge",
      toolpath: "mesh.split_edge",
      inputs  : ToolOp.inherit({})
    }
  }

  exec(ctx) {
    let mesh = ctx.mesh;

    for (let e of new Set(mesh.edges.selected.editable)) {
      mesh.splitEdge(e);
    }
  }
}

ToolOp.register(SplitEdgeOp);


export class DissolveVertOp extends MeshOp {
  static tooldef() {
    return {
      uiname  : "Dissolve Vertex",
      toolpath: "mesh.dissolve_vertex",
      inputs  : ToolOp.inherit({})
    }
  }

  exec(ctx) {
    let mesh = ctx.mesh;

    for (let v of new Set(mesh.verts.selected.editable)) {
      mesh.dissolveVertex(v);
    }
  }
}

ToolOp.register(DissolveVertOp);


export class DeleteOp extends MeshOp {
  static tooldef() {
    return {
      uiname  : "Delete",
      toolpath: "mesh.delete",
      inputs  : ToolOp.inherit({
        selMask: new FlagProperty(config.SELECTMASK, MeshTypes)
      })
    }
  }

  static invoke(ctx, args) {
    let tool = super.invoke(ctx, args);

    console.log("DELETE", ctx.selMask, ctx);
    if (!("selMask" in args)) {
      tool.inputs.selMask.setValue(ctx.selMask);
    }

    return tool;
  }

  exec(ctx) {
    let mesh = ctx.mesh;
    let {selMask} = this.getInputs();

    console.log("Delete!", selMask);

    if (selMask & MeshTypes.FACE) {
      for (let v of new Set(mesh.faces.selected.editable)) {
        mesh.killFace(v);
      }
    }

    if (selMask & MeshTypes.EDGE) {
      for (let v of new Set(mesh.edges.selected.editable)) {
        mesh.killEdge(v);
      }
    }

    if (selMask & MeshTypes.VERTEX) {
      for (let v of new Set(mesh.verts.selected.editable)) {
        mesh.killVertex(v);
      }
    }
  }
}

ToolOp.register(DeleteOp);
