const https = require('https');
const fs = require('fs');
const path = require('path');

const vueUrl = 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.js';
const outputPath = path.join(__dirname, '..', 'frontend', 'vue.global.js');

console.log('正在下载 Vue.js...');

https.get(vueUrl, (response) => {
  if (response.statusCode === 301 || response.statusCode === 302) {
    https.get(response.headers.location, (redirectResponse) => {
      saveResponse(redirectResponse);
    });
  } else {
    saveResponse(response);
  }
}).on('error', (err) => {
  console.error('下载失败:', err.message);
  console.log('尝试使用备用源...');
  
  const backupUrl = 'https://unpkg.com/vue@3/dist/vue.global.js';
  https.get(backupUrl, (response) => {
    if (response.statusCode === 301 || response.statusCode === 302) {
      https.get(response.headers.location, (redirectResponse) => {
        saveResponse(redirectResponse);
      });
    } else {
      saveResponse(response);
    }
  }).on('error', (err2) => {
    console.error('备用源也失败:', err2.message);
    console.log('创建 Vue.js 最小版本...');
    createMinimalVue();
  });
});

function saveResponse(response) {
  let data = '';
  response.on('data', (chunk) => {
    data += chunk;
  });
  response.on('end', () => {
    fs.writeFileSync(outputPath, data, 'utf-8');
    console.log(`Vue.js 已保存到 ${outputPath}`);
    console.log(`文件大小: ${(data.length / 1024).toFixed(1)} KB`);
  });
}

function createMinimalVue() {
  const minimalVue = `
(function(global) {
  'use strict';
  
  let currentEffect = null;
  const effectStack = [];
  
  function track(target, key) {
    if (currentEffect) {
      let depsMap = target.__v_deps;
      if (!depsMap) {
        depsMap = new Map();
        Object.defineProperty(target, '__v_deps', { value: depsMap, enumerable: false });
      }
      let deps = depsMap.get(key);
      if (!deps) {
        deps = new Set();
        depsMap.set(key, deps);
      }
      deps.add(currentEffect);
    }
  }
  
  function trigger(target, key) {
    const depsMap = target.__v_deps;
    if (depsMap) {
      const deps = depsMap.get(key);
      if (deps) {
        deps.forEach(effect => {
          if (effect.scheduler) {
            effect.scheduler();
          } else {
            effect();
          }
        });
      }
    }
  }
  
  function ref(value) {
    const r = {
      __v_isRef: true,
      get value() {
        track(r, 'value');
        return value;
      },
      set value(newVal) {
        if (newVal !== value) {
          value = newVal;
          trigger(r, 'value');
        }
      }
    };
    return r;
  }
  
  function reactive(obj) {
    return new Proxy(obj, {
      get(target, key) {
        track(target, key);
        return target[key];
      },
      set(target, key, value) {
        if (target[key] !== value) {
          target[key] = value;
          trigger(target, key);
        }
        return true;
      }
    });
  }
  
  function effect(fn, options = {}) {
    const effectFn = () => {
      try {
        effectStack.push(effectFn);
        currentEffect = effectFn;
        return fn();
      } finally {
        effectStack.pop();
        currentEffect = effectStack[effectStack.length - 1];
      }
    };
    if (!options.lazy) {
      effectFn();
    }
    effectFn.scheduler = options.scheduler;
    return effectFn;
  }
  
  function computed(getter) {
    let value;
    let dirty = true;
    const runner = effect(getter, {
      lazy: true,
      scheduler() {
        dirty = true;
        trigger(c, 'value');
      }
    });
    const c = {
      __v_isRef: true,
      get value() {
        if (dirty) {
          value = runner();
          dirty = false;
        }
        track(c, 'value');
        return value;
      }
    };
    return c;
  }
  
  const mountedHooks = [];
  
  function onMounted(fn) {
    mountedHooks.push(fn);
  }
  
  function createApp(options) {
    return {
      mount(selector) {
        const container = document.querySelector(selector);
        const ctx = options.setup ? options.setup() : {};
        const scope = { ctx, $data: {} };
        
        function evaluate(expr) {
          try {
            const keys = Object.keys(ctx);
            const values = keys.map(k => {
              const v = ctx[k];
              return v && v.__v_isRef ? v.value : v;
            });
            const fn = new Function(...keys, 'return ' + expr);
            return fn(...values);
          } catch (e) {
            return undefined;
          }
        }
        
        function setValue(path, value) {
          if (ctx[path] && ctx[path].__v_isRef) {
            ctx[path].value = value;
          }
        }
        
        function processDirectives(el) {
          const attrs = Array.from(el.attributes);
          
          for (const attr of attrs) {
            if (attr.name.startsWith('v-')) {
              const [dir, arg] = attr.name.slice(2).split(':');
              const expr = attr.value;
              
              if (dir === 'if') {
                el.__v_if = expr;
                el.__v_original = el.cloneNode(true);
              } else if (dir === 'for') {
                el.__v_for = expr;
                el.__v_original = el.cloneNode(true);
              } else if (dir === 'model') {
                el.addEventListener('input', (e) => {
                  setValue(expr, e.target.value);
                });
              }
            } else if (attr.name.startsWith('@')) {
              const event = attr.name.slice(1);
              const expr = attr.value;
              el.addEventListener(event, () => {
                if (expr.endsWith(')')) {
                  evaluate(expr);
                } else {
                  const fn = ctx[expr];
                  if (fn) fn();
                }
              });
            } else if (attr.name.startsWith(':')) {
              const arg = attr.name.slice(1);
              el.__v_bind = el.__v_bind || {};
              el.__v_bind[arg] = attr.value;
            }
          }
        }
        
        function render() {
          function walk(node) {
            if (node.nodeType === 1) {
              processDirectives(node);
              
              if (node.__v_if) {
                const result = evaluate(node.__v_if);
                if (!result) {
                  node.style.display = 'none';
                } else {
                  node.style.display = '';
                }
              }
              
              if (node.__v_bind) {
                for (const [arg, expr] of Object.entries(node.__v_bind)) {
                  const value = evaluate(expr);
                  if (arg === 'class') {
                    if (typeof value === 'object') {
                      node.className = Object.entries(value)
                        .filter(([k, v]) => v)
                        .map(([k]) => k)
                        .join(' ');
                    } else {
                      node.className = value || '';
                    }
                  } else {
                    node.setAttribute(arg, value);
                  }
                }
              }
              
              if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT') {
                const modelAttr = Array.from(node.attributes).find(a => a.name === 'v-model');
                if (modelAttr) {
                  const value = evaluate(modelAttr.value);
                  if (node.type === 'checkbox') {
                    node.checked = !!value;
                  } else {
                    node.value = value || '';
                  }
                }
              }
              
              if (node.__v_for) {
                const parent = node.parentNode;
                const expr = node.__v_for;
                const match = expr.match(/(\\w+)\\s+in\\s+(.+)/);
                if (match) {
                  const [, itemName, listExpr] = match;
                  const list = evaluate(listExpr) || [];
                  
                  const placeholder = document.createComment('v-for');
                  if (node.nextSibling && node.nextSibling.__v_for_placeholder) {
                    parent.insertBefore(placeholder, node.nextSibling);
                  } else {
                    parent.insertBefore(placeholder, node.nextSibling);
                    placeholder.__v_for_placeholder = true;
                  }
                  
                  let current = placeholder.nextSibling;
                  while (current && !current.__v_for_placeholder) {
                    const next = current.nextSibling;
                    parent.removeChild(current);
                    current = next;
                  }
                  
                  list.forEach((item, index) => {
                    const clone = node.__v_original.cloneNode(true);
                    clone.__v_item = { [itemName]: item, index };
                    parent.insertBefore(clone, placeholder);
                    walk(clone);
                  });
                  
                  node.style.display = 'none';
                }
              }
              
              Array.from(node.childNodes).forEach(walk);
            } else if (node.nodeType === 3) {
              const text = node.textContent;
              if (text.includes('{{')) {
                if (!node.__v_original) {
                  node.__v_original = text;
                }
                let result = node.__v_original;
                const regex = /\\{\\{(.+?)\\}\\}/g;
                let match;
                while ((match = regex.exec(node.__v_original)) !== null) {
                  const value = evaluate(match[1].trim());
                  result = result.replace(match[0], value !== undefined ? value : '');
                }
                node.textContent = result;
              }
            }
          }
          
          walk(container);
        }
        
        function reactiveEffect(fn) {
          return effect(fn, {
            scheduler() {
              queueMicrotask(render);
            }
          });
        }
        
        const originalEffect = effect;
        effect = reactiveEffect;
        
        render();
        
        mountedHooks.forEach(fn => fn());
        
        return ctx;
      }
    };
  }
  
  global.Vue = {
    createApp,
    ref,
    reactive,
    computed,
    onMounted,
    effect
  };
  
})(typeof window !== 'undefined' ? window : global);
`;
  
  fs.writeFileSync(outputPath, minimalVue, 'utf-8');
  console.log('已创建 Vue.js 最小兼容版本');
}
