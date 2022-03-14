import * as parseutil from '../path.ux/scripts/path-controller/util/parseutil.js';

let tk = (name, re, func) => new parseutil.tokdef(name, re, func);

export const keywords = new Set([
  "include", "if", "ifdef", "ifndef", "else", "elif", "endif", "undef", "define"
]);

export function strip_comments(s) {
  let state = 0;
  let out = '';

  const BASE = 0;
  const BLOCK = 1;
  const LINE = 2;
  const STR = 3;

  let blocklvl = 0;

  for (let i = 0; i < s.length; i++) {
    let p = s[Math.max(i - 1, 0)];
    let c = s[i];
    let n = s[Math.min(i + 1, s.length - 1)];

    switch (state) {
      case BASE:
        if (c === "/" && n === "*") {
          state = BLOCK;
          blocklvl++;
        } else if (c === "/" && n === "/") {
          state = LINE;
        } else if (c === "\"") {
          state = STR;
          out += c;
        } else {
          out += c;
        }
        break;
      case BLOCK:
        if (p === "*" && c === "/") {
          blocklvl = Math.max(blocklvl-1, 0);

          if (blocklvl === 0) {
            state = BASE;
          }
        } else if (c === "/" && n === "*") {
          blocklvl++;
        }

        if (c === "\n") {
          out += "\n";
        }
        break;
      case LINE:
        if (c === "\n") {
          out += "\n";
          state = BASE;
        }
        break;
      case STR:
        if (c  === "\"" && p !== "\\") {
          state = BASE;
        }
        out += c;
        break;
    }
  }

  return out; //implement me!
}

function list(iter) {
  let list = [];

  for (let item of iter) {
    list.push(item);
  }

  return list;
}

/** Converts (lower-case) keywords in t.value
 *  to upper-case keywords in t.type. */
function doKeyword(t) {
  if (keywords.has(t.value)) {
    t.type = t.value.toUpperCase();
  }

  return t;
}

function doNumber(t) {
  t.value = parseFloat(t.value);

  return t;
}

function doStrLit(t) {
  t.value = t.value.slice(1, t.value.length - 1);
  return t;
}

function doIsDefined(t) {
  t.value = t.value.slice(("defined(").length, t.value.length - 1);

  return t;
}

let tokdef = [
  tk("ID", /[a-zA-Z$_]+[a-zA-Z$_0-9]*/, t => doKeyword(t)),
  tk("DEFINED", /defined\([a-zA-Z$_]+[a-zA-Z$_0-9]*\)/, t => doIsDefined(t)),
  tk("NUM", /[+-]?[0-9]+/, t => doNumber(t)),
  tk("NUM", /[+-]?[0-9]+\.[0-9]*/, t => doNumber(t)),
  tk("NUM", /[+-]?[0-9]*\.[0-9]+/, t => doNumber(t)),
  tk("LPAREN", /\(/),
  tk("RPAREN", /\)/),
  tk("COMMA", /,/),
  tk("LSBRACKET", /\[/),
  tk("RSBRACKET", /\]/),
  tk("GTHAN", />/),
  tk("LTHAN", /</),
  tk("GTHANEQ", />=/),
  tk("LTHANEQ", /<=/),
  tk("NOTEQ", /!=/),
  tk("LBRACE", /{/),
  tk("RBRACE", /}/),
  tk("BAND", /&/),
  tk("BOR", /\|/),
  tk("BXOR", /\^/),
  tk("BINV", /~/),
  tk("EQ", /==/),
  tk("NOT", /!/),
  tk("LOR", /\|\|/),
  tk("LAND", /&&/),
  tk("AT", /@/),
  tk("TIMES", /\*/),
  tk("PLUS", /\+/),
  tk("MINUS", /-/),
  tk("DIV", /\//),
  tk("MOD", /%/),
  tk("JOIN", /##/),
  tk("WS", /[ \t]+/, t => undefined), //drop token
  tk("STRLIT", /"[^"]*"/, t => doStrLit(t)),
];

export class FragmentManager {
  constructor() {
    this.fragments = new Map();
  }

  addFragment(fragment, path) {
    this.fragments.set(path, fragment);
  }

  get(path) {
    return this.fragments.get(path);
  }

  has(path) {
    return this.fragments.has(path);
  }

  [Symbol.iterator]() {
    return this.fragments[Symbol.iterator]();
  }

  add(fragdef, path) {
    for (let k in fragdef) {
      let v = fragdef[k];

      if (typeof v !== "string") {
        continue;
      }

      let path2 = path + "." + k;
      this.addFragment(v, path2);
    }
  }
}

export const scriptManger = new FragmentManager();

export class Preprocessor {
  constructor(scripts = scriptManger) {
    this.manager = scripts;
    this.defs = {};
    this.ifstack = [];
    this.excluded = false;
    this.wasElif = false;
  }

  process(code) {
    let output = '';
    let lines;

    let p;

    let out = (s) => {
      output += s;
    }
    let p_Define = () => {
      let id = p.expect("ID");

      let toks = [];

      let prev;
      let dojoin = false;

      while (!p.at_end()) {
        let t = p.next();

        if (t.type === "JOIN") {
          dojoin = true;
          continue;
        }

        if (dojoin) {
          toks[toks.length - 1].value += t.value;
          dojoin = false;
        } else {
          toks.push(t);
        }
      }

      if (toks.length === 1) {
        toks = toks[0];
      }

      this.defs[id] = toks;
    }

    let binfuncs = {
      "/"(a, b) {

      },
      "*"(a, b) {
        return a*b;
      },
      "+"(a, b) {
        return a + b;
      },
      "-"(a, b) {
        return a - b;
      },
      ">"(a, b) {
        return a > b;
      },
      "<"(a, b) {
        return a < b;
      },
      ">="(a, b) {
        return a >= b;
      },
      "<="(a, b) {
        return a <= b;
      },
      "&"(a, b) {
        return a & b;
      },
      "|"(a, b) {
        return a | b;
      },
      "^"(a, b) {
        return a ^ b;
      },
      "&&"(a, b) {
        return a && b;
      },
      "||"(a, b) {
        return a || b;
      },
      "=="(a, b) {
        return a === b;
      },
      "!="(a, b) {
        return a !== b;
      }
    }

    let precmap = {};
    let i = 0;
    for (let k in binfuncs) {
      precmap[k] = i++;
    }

    function error(tok, msg) {
      p.error(tok, msg);
      throw new parseutil.PUTIL_ParseError(msg);
    }

    let binops = new Set(list("+-*/&^|%<>").concat(["||", "&&", "==", "!=", ">=", "<="]));
    let p_BinOp = (t2) => {
      if (!binops.has(t2.value)) {
        p.error(t2, "Expected a binary operator, not " + t2.value);
      }

      return t2.value;
    }

    //consumes t1
    let p_Value = (t1) => {
      if (!(t1 instanceof parseutil.token)) {
        return t1;
      }

      p.next();

      if (t1.type === "NUMLIT") {
        return t1;
      } else if (t1.type === "ID") {
        return t1;
      } else if (t1.type === "DEFINED") {
        t1.type = "NUMLIT";
        t1.value = t1.value in this.defs;
      } else {
        error(t1, "Invalid expression value " + t1.type);
      }

      return t1;
    }

    let isValue = (t1) => {
      if (!(t1 instanceof parseutil.token)) {
        return true;
      }

      return t1.type === "ID" || t1.type === "NUMLIT" || t1.type === "DEFINED";
    }

    let unaryops = new Set(["NOT", "BINV", "MINUS"]);

    let getValue = t => t instanceof parseutil.token ? t.value : t;

    let p_Eval = (t1, t2) => {
      let peeki = t1 instanceof parseutil.token ? 2 : 1;

      let t3 = p.peek_i(peeki++);
      let t4 = p.peek_i(peeki++);
      let t5 = p.peek_i(peeki++);

      console.log("" + t1, "" + t2);
      console.log("" + t3, "" + t4);
      console.log("");

      if (unaryops.has(t1.type)) {
        p.next(); //consume t1

        return {
          a      : p_Eval(t2, t3),
          unaryop: t1.value
        }
      }

      if (isValue(t1)) {
        console.log("TT1", "" + p.peek_i(0), "" + t1);
        console.log("TT2", "" + p.peek_i(1), "" + t2);

        t1 = p_Value(t1); //consumes t1

        let a = getValue(t1);

        if (t2.type === "RPAREN") {
          p.next(); //consume t2

          console.log("TT", "" + p.peek_i(0), "" + p.peek_i(1));
          console.log("");

          if (0 && t3 && t4) {
            //console.log("LLLL", ""+t1);

            let ret = p_Eval(a, t3);
            ret.rparen = true;
            //ret.prec = -100;

            return ret;
            return getValue(t1);
          } else {
            return a;
          }
        }

        let binop = p_BinOp(t2);

        let stop = !t3;

        if (stop) {
          if (!t2) {
            return a;
          }

          console.log("T1", "" + t1);
          console.log("T2", "" + t2);
          t2 = p_Value(t2); //consumes t2

          return {
            binop,
            prec: precmap[binop],
            a,
            b   : getValue(t2)
          };
        } else {
          p.next(); //consume t2
        }

        //t1  t2  t3  t4  t5
        //a   +   b   *   c

        let prec2;
        let b;

        console.log("T4", "" + t4);

        if (t4 && (binops.has(t4.value) || (t3.type === "LPAREN") || t4.type === "RPAREN")) {
          b = p_Eval(t3, t4);

          if (typeof b === "object" && b.prec > precmap[binop]) {
            b.a = {
              binop,
              prec: precmap[binop],
              a, b: b.a
            }

            return b;
          } else {
            return {
              binop,
              prec: precmap[binop],
              a, b
            }
          }
        } else {
          t3 = p_Value(t3); //consumes t3

          return {
            binop,
            prec: precmap[binop],
            a, b: getValue(t3),
          }
        }
      } else if (t1.type === "LPAREN") {
        p.next(); //consume t1
        let ret = p_Eval(t2, t3);

        t3 = p.peek_i(0);
        t4 = p.peek_i(1);

        console.log("N1", "" + t3);
        console.log("N2", "" + t4);

        ret.paren = true;

        if (t3 && t4) {
          let ret2 = p_Eval(ret, t3);
          ret2.lparen = true;
          //ret2.paren = true;
          ret2.prec = -100;
          return ret2;
        }

        ret.paren = true;
        ret.lparen = true;
        ret.prec = -100;
        return ret;
      }

      console.log("ERROR", t1.type, t1.value);
    }

    let p_EvalEval = () => {
      let str = '';
      while (!p.at_end()) {
        let t = p.next();
        if (t.type === "DEFINED") {
          str += t.value in this.defs;
        } else if (t.type === "ID") {
          let d = this.defs[t.value];

          if (d === undefined) {
            error(t, "Unknown preprocessor definition " + t.value);
          }

          if (d && Array.isArray(d)) {
            for (let tok of d.tokens) {
              str += tok.value;
            }
          } else if (d !== null && d instanceof parseutil.token) {
            str += d.value;
          } else if (d !== null) {
            str += d;
          }
        } else {
          str += t.value;
        }

        str += " ";
      }

      console.log(str);
      return eval(str);
    }

    let linei;

    let p_Include = () => {
      let t = p.peeknext();

      let path = p.expect("STRLIT");
      console.log("PATH", path);

      if (!this.manager.has(path)) {
        error(t, "Unknown script include fragment " + path);
      }

      let frag = strip_comments(this.manager.get(path));
      frag = frag.split("\n");

      lines = lines
        .slice(0, linei)
        .concat(["\n"]) //replace #include line so linei is correct
        .concat(frag) //add fragment
        .concat(lines
          .slice(linei + 1, lines.length));
    }

    let p_If = () => {
      this.ifstack.push([this.excluded, this.wasElif]);
      this.wasElif = false;

      this.excluded = !p_EvalEval(p.peek_i(0), p.peek_i(1));
    }

    let p_Ifdef = () => {
      let id = p.expect("ID");

      this.ifstack.push([this.excluded, this.wasElif]);
      this.wasElif = false;

      console.log("ID", id, id in this.defs);

      if (!this.excluded) {
        this.excluded = !(id in this.defs);
      }
    }

    let p_Ifndef = () => {
      let id = p.expect("ID");

      this.ifstack.push([this.excluded, this.wasElif]);
      this.wasElif = false;

      console.log("ID", id, id in this.defs);

      if (!this.excluded) {
        this.excluded = id in this.defs;
      }
    }

    let p_Elif = () => {
      if (this.excluded && !this.wasElif) {
        this.excluded = !p_EvalEval(p.peek_i(0), p.peek_i(1));
      } else {
        while (!p.at_end()) {
          p.next();
        }

        if (!this.excluded) {
          this.wasElif = true;
        }

        this.excluded = true;
      }
    }
    let p_Else = () => {
      if (this.excluded && !this.wasElif) {
        this.excluded = false;
      } else {
        this.excluded = true;
      }
    }
    let p_Endif = () => {
      [this.excluded, this.wasElif] = this.ifstack.pop();
    }

    let p_Undef = () => {
      let id = p.expect("ID");
      delete this.defs[id];
    }

    let handlers = {
      "DEFINE" : p_Define,
      "INCLUDE": p_Include,
      "IF"     : p_If,
      "IFDEF"  : p_Ifdef,
      "ELIF"   : p_Elif,
      "ELSE"   : p_Else,
      "ENDIF"  : p_Endif,
      "UNDEF"  : p_Undef,
      "IFNDEF" : p_Ifndef,
    };

    let p_Start = (p) => {
      for (let k in handlers) {
        if (p.optional(k)) {
          handlers[k](p);
          return;
        }
      }

      let t = p.next();
      p.error(t, "Invalid preprocessor statement " + t.type);
    }

    function printeval(n) {
      if (typeof n !== "object") {
        return "" + n;
      }

      let s = '';

      let paren = 1 || n.paren;

      if (paren) {
        s += "("
      }

      if (n.binop) {
        s += printeval(n.a) + " " + n.binop + " " + printeval(n.b);
      } else if (n.unaryop) {
        s += n.unaryop + printeval(n.a);
      }

      if (paren) {
        s += ")";
      }

      return s;
    }

    let lexer = new parseutil.lexer(tokdef);
    //lexer.print_tokens = true;

    p = this.parser = new parseutil.parser(lexer);
    p.start = p_Start;

    if (0) {
      let test = `(!(defined(a) * b) + (c > d))`
      p.lexer.input(test);

      let ret = p_Eval(p.peek_i(0), p.peek_i(1));

      console.log(JSON.stringify(ret, undefined, 2));
      console.log(printeval(ret));
      console.log(test);
    }


    lines = strip_comments(code).split("\n");

    for (linei = 0; linei < lines.length; linei++) {
      i = linei;
      let l = lines[i];

      if (!l.trim().startsWith("#")) {
        if (!this.excluded) {
          out(l + "\n");
        }
        continue;
      } else {
        while (i < lines.length && l.endsWith("\\")) {
          i++;
          l += lines[i].slice(0, lines[i].length - 1);
        }

        l = l.trim();
        l = l.slice(1, l.length).trim();

        if (this.excluded && (l.startsWith("define") || l.startsWith("include"))) {
          continue;
        }

        p.parse(l);
      }
    }
    return output;
  }
}


window.testPreprocessor = function () {
  let manager = new FragmentManager();

  manager.add({
    c: `
float a;
#define C
    `,
    d: `D12345`,
  }, "frag");
  let code = `

#define A 1
#define B 2

/*
comment comment
/*
more comments
*/
*/

//line comment

#if defined(A8)
BRANCHA
#elif B + A - 1 == 2
BRANCHB
#else
BRANCHC
#endif  

#if 0
#elif 1
#if 1
b1;
#elif 0
b2;
#elif 0
b3;
#elif 0
b4;
#else
b5;
#endif
#endif

#include "frag.c"
  
  `;

  let pp = new Preprocessor(manager);
  console.log(pp.process(code));

}

export function preprocess(code, manager = scriptManger) {
  return new Preprocessor(manager).process(code);
}
