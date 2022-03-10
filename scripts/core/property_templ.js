import {
  NumberConstraints, nstructjs, PropTypes, util, simple, DataStruct, PropSubTypes, UIBase, Container, saveUIData,
  loadUIData
} from '../path.ux/scripts/pathux.js';

/* maps both name -> proptype and proptype -> name */
export const PropTypeMap = {
  "float" : PropTypes.FLOAT,
  "int" : PropTypes.INT,
  "vec2" : PropTypes.VEC2,
  "vec3" : PropTypes.VEC3,
  "vec4" : PropTypes.VEC4,
  "color3" : PropTypes.VEC3,
  "color4" : PropTypes.VEC4,
  "string" : PropTypes.STRING,
  "enum" : PropTypes.ENUM,
  "flags" : PropTypes.FLAG,
  "bool" : PropTypes.BOOL,
};

for (let k in PropTypeMap) {
  //colors are a PropSubType .subtype field
  if (k !== "color3" && k !== "color4") {
    PropTypeMap[PropTypeMap[k]] = k;
  }
}

let idgen = 0;

export class PropertiesBag {
  constructor(template) {
    this._props = [];
    this._struct = new DataStruct();

    //these two are used by props widget to detect updates
    this._updateGen = 0;
    this._id = idgen++;

    if (template) {
      this.loadTemplate(template);
    }
  }

  static defineAPI(api, st) {
    api.mapStructCustom(this, this.getStruct.bind(this));
  }

  static getStruct(obj) {
    return obj._struct;
  }

  _getTemplValue(item) {
    let val = item.value;

    if (val === undefined) {
      if (item.type === "string") {
        val = "";
      } else if (item.type === "vec2") {
        val = [0, 0];
      } else if (item.type === "vec3" || item.type === "color3") {
        val = [0, 0, 0];
      } else if (item.type === "vec4" || item.type === "color4") {
        val = [0, 0, 0, 1];
      } else {
        val = 0;
      }
    }

    return val;
  }

  patchTemplate(templ) {
    this._props.length = 0;

    this._updateGen++;

    for (let k in templ) {
      let item = templ[k];

      if (typeof item !== "object") {
        item = {type: item};
      }

      if (this[k] === undefined) {
        this[k] = this._getTemplValue(item);
      }
    }

    let st = this._struct;
    st.clear();

    for (let k in templ) {
      let item = templ[k];

      if (typeof item !== "object") {
        item = {type: item};
      }

      let uiname = item.uiName ?? ToolProperty.makeUIName(k);
      let descr = item.description ?? "";
      let def;

      if (item.type === "float") {
        def = st.float(k, k, uiname, descr);
      } else if (item.type === "int") {
        def = st.int(k, k, uiname, descr);
      } else if (item.type === "vec2") {
        def = st.vec2(k, k, uiname, descr);
      } else if (item.type === "vec3") {
        def = st.vec3(k, k, uiname, descr);
      } else if (item.type === "vec4") {
        def = st.vec4(k, k, uiname, descr);
      } else if (item.type === "color3") {
        def = st.color3(k, k, uiname, descr);
      } else if (item.type === "color4") {
        def = st.color4(k, k, uiname, descr);
      } else if (item.type === "string") {
        def = st.string(k, k, uiname, descr);
      } else if (item.type === "enum") {
        def = st.enum(k, k, item.def, uiname, descr);
      } else if (item.type === "flags") {
        def = st.flags(k, k, item.def, uiname, descr);
      } else if (item.type === "bool") {
        def = st.bool(k, k, uiname, descr);
      }

      if (!def) {
        console.error("Unknown property type " + item.type, item);
        continue;
      }

      def.on('change', window.redraw_all);

      if (item.onchange) {
        def.on('change', item.onchange);
      }

      this._props.push(def.data.copy());

      let pr = PropTypes;
      let numberTypes = pr.FLOAT | pr.INT | pr.VEC2 | pr.VEC3 | pr.VEC4;

      def.data.apiname = k;

      if (def.data.type & numberTypes) {
        for (let key of NumberConstraints) {
          if (key in item) {
            def.data[key] = item[key];
          }
        }

        if ("min" in item) {
          def.data.range[0] = item.min;
        }

        if ("max" in item) {
          def.data.range[1] = item.max;
        }

        if ("uiMin" in item) {
          if (!def.data.uiRange) {
            def.data.uiRange = util.list(def.data.range);
          }
          def.data.uiRange[0] = item.uiMin;
        }

        if ("uiMax" in item) {
          if (!def.data.uiRange) {
            def.data.uiRange = util.list(def.data.range);
          }
          def.data.uiRange[1] = item.uiMax;
        }
      }
    }
  }

  loadTemplate(templ) {
    for (let k in templ) {
      let item = templ[k];
      if (typeof item !== "object") {
        item = {type: item};
      }

      //this[k] = this._getTemplValue(item);
    }

    this.patchTemplate(templ);
  }

  static templateFromProps(props) {
    let templ = {};

    for (let prop of props) {
      let item = {};
      templ[prop.apiname] = item;

      let type = PropTypeMap[prop.type];

      if (prop.subtype === PropSubTypes.COLOR) {
        type = prop.type === PropTypes.VEC3 ? "color3" : "color4";
      }

      item.type = type;
      item.uiName = prop.uiname;
      item.value = prop.getValue();

      let pr = PropTypes;
      let numberTypes = pr.FLOAT | pr.INT | pr.VEC2 | pr.VEC3 | pr.VEC4;

      if (prop.type & numberTypes) {
        for (let key of NumberConstraints) {
          if (prop[key] === undefined) {
            continue;
          }

          if (key === "range") {
            [item.min, item.max] = prop.range;
          } else if (key === "uiRange") {
            [item.uiMin, item.uiMax] = prop.uiRange;
          } else {
            item[key] = prop[key];
          }
        }
      }
    }

    return templ;
  }

  _save() {
    for (let prop of this._props) {
      prop.setValue(this[prop.apiname]);
    }

    console.log("SAVE PROPS", util.list(this._props));
    return this._props;
  }

  loadSTRUCT(reader) {
    reader(this);

    let templ = this.constructor.templateFromProps(this._props);
    this.loadTemplate(templ);
  }

  testStruct() {
    let json = nstructjs.writeJSON(this);
    console.log(json);

    let obj = nstructjs.readJSON(json, this.constructor);
    console.log(obj);

    return obj;
  }
}
PropertiesBag.STRUCT = `
PropertiesBag {
  _props : array(abstract(ToolProperty)) | this._save();
}
`;
simple.DataModel.register(PropertiesBag);

export class PropsEditor extends Container {
  constructor() {
    super();

    this.needsRebuild = true;
    this._last_update_key = undefined;
  }

  static define() {
    return {
      tagname : "props-bag-editor-x"
    }
  }

  init() {
    super.init();

    if (this.ctx && this.hasAttribute("datapath")) {
      this.rebuild();
    }
  }

  get columns() {
    if (this.hasAttribute("columns")) {
      return parseInt(this.getAttribute("columns"));
    } else {
      return 1;
    }
  }

  set columns(v) {
    this.setAttribute("columns", ""+v);
  }

  rebuild() {
    let uidata = saveUIData(this, "props editor");

    let cols = this.columns;
    let path = this.getAttribute("datapath");
    let props = this.ctx.api.getValue(this.ctx, path);

    if (!props) {
      console.warn("Bad datapath", path);
      return;
    }

    this.needsRebuild = false;
    this.dataPrefix = path;

    this.clear();

    console.log("Columns", cols);
    cols = (new Array(cols).fill(1)).map(c => this.col());
    let i = 0;

    for (let prop of props._props) {
      let col = cols[i % cols.length]

      col.prop(prop.apiname);
      i++;
    }

    loadUIData(this, uidata);
  }

  update() {
    super.update();

    if (!this.ctx) {
      return;
    }

    let path = this.getAttribute("datapath");

    let props = this.ctx.api.getValue(this.ctx, path);
    if (!props) {
      console.warn("Bad datapath", path);
      return;
    }

    let key = "" + props._updateGen + ":" + props._id + ":" + props._props.length;

    if (key !== this._last_update_key) {
      this._last_update_key = key;
      this.needsRebuild = true;
    }

    if (this.needsRebuild) {
      this.rebuild();
    }
  }
}
UIBase.register(PropsEditor);

