if (!globalThis.window) {
  globalThis.window = globalThis;

  globalThis.addEventListener = function () {
  };
  globalThis.removeEventListener = function () {
  };

  globalThis.PointerEvent = class {

  };

  globalThis.devicePixelRatio = 1.0;

  globalThis.EventTarget = class EventTarget {
    addEventListener() {

    }

    removeEventListener() {

    }

    dispatchEvent() {

    }
  };

  globalThis.Element = class Element extends EventTarget {
    constructor(tagname = '', children = {}) {
      this.tagName = tagname.toUpperCase();
      this.style = {};

      this.childNodes = [];

      for (let k in children) {
        this.childNodes.push(children[k]);
      }
    }

    getAttribute() {

    }

    setAttribute() {

    }

    hasAttribute() {

    }
  }
  globalThis.HTMLElement = class HTMLElement {
  }
  globalThis.HTMLCanvasElement = class HTMLCanvasElement extends HTMLElement {
    constructor() {
      super("canvas");
    }

    getContext(type) {
      let stub = function () {
      };

      return {
        beginPath   : stub,
        closePath   : stub,
        moveTo      : stub,
        rect        : stub,
        clearRect   : stub,
        lineTo      : stub,
        putImageData: stub,
        getImageData(width, height) {
          return {
            width, height, data: new Uint8Array(width*height*4)
          }
        },
        drawImage: stub,
        fill     : stub,
        stroke   : stub,
        translate: stub,
        scale    : stub,
        rotate   : stub,
        save     : stub,
        restore  : stub,
        clip     : stub,
      };
    }

    toDataURL() {
      return '';
    }
  }

  globalThis.customElements = {
    registry: {},

    define(tagname, cls) {
      this.registry[tagname] = cls;
    }
  }
  customElements.define("canvas", HTMLCanvasElement);

  globalThis.document = new (class Document extends EventTarget {
    constructor() {
      super();
      this.body = new HTMLElement("body");
    }

    createElement(tagname) {
      if (tagname in customElements.registry) {
        return new customElements.registry[tagname]();
      }

      return new HTMLElement(tagname);
    }

    getElementById() {
    }
  });

  globalThis.location = {
    origin: 'https://localhost',
    host  : 'https://localhost',
    href  : 'https://localhost',
  }
  globalThis.navigator = {
    userAgent : 'mozilla'
  }
}

import('../path.ux/pathux.js', pathux => {
  pathux.cconst.loadConstants({
    autoLoadSplineTemplates : false,
  });
});
