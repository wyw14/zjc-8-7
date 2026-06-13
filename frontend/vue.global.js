(function(global) {
  'use strict';
  
  let currentEffect = null;
  
  function track(target, key) {
    if (currentEffect && currentEffect.deps) {
      let depsMap = target.__deps;
      if (!depsMap) {
        depsMap = new Map();
        Object.defineProperty(target, '__deps', { value: depsMap, enumerable: false });
      }
      let deps = depsMap.get(key);
      if (!deps) {
        deps = new Set();
        depsMap.set(key, deps);
      }
      deps.add(currentEffect);
      currentEffect.deps.add(deps);
    }
  }
  
  function trigger(target, key) {
    const depsMap = target.__deps;
    let scheduled = false;
    if (depsMap) {
      const deps = depsMap.get(key);
      if (deps) {
        const effects = new Set(deps);
        effects.forEach(effect => {
          if (effect.scheduler) {
            effect.scheduler();
            scheduled = true;
          } else {
            effect();
            scheduled = true;
          }
        });
      }
    }
    if (!scheduled && typeof scheduleRenderFallback === 'function') {
      scheduleRenderFallback();
    }
  }
  
  function ref(value) {
    const r = {
      __v_isRef: true,
      _raw: value,
      get value() {
        track(r, 'value');
        return r._raw;
      },
      set value(newVal) {
        if (newVal !== r._raw) {
          r._raw = newVal;
          trigger(r, 'value');
        }
      },
      $set: function(newVal, silent = false) {
        if (newVal !== r._raw) {
          r._raw = newVal;
          if (!silent) {
            trigger(r, 'value');
          }
        }
      }
    };
    return r;
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
  
  function effect(fn, options = {}) {
    const effectFn = () => {
      try {
        currentEffect = effectFn;
        effectFn.deps = new Set();
        return fn();
      } finally {
        currentEffect = null;
      }
    };
    if (!options.lazy) {
      effectFn();
    }
    effectFn.scheduler = options.scheduler;
    return effectFn;
  }
  
  const mountedHooks = [];
  
  function onMounted(fn) {
    mountedHooks.push(fn);
  }
  
  function createApp(options) {
    return {
      mount(selector) {
        const container = document.querySelector(selector);
        const originalHTML = container.innerHTML;
        const ctx = options.setup ? options.setup() : {};
        let isFirstRender = true;
        
        const refs = {};
        Object.keys(ctx).forEach(key => {
          if (ctx[key] && ctx[key].__v_isRef) {
            refs[key] = ctx[key];
          }
        });
        
        function unwrap(v) {
          return v && v.__v_isRef ? v.value : v;
        }
        
        function evaluate(expr, extra = {}) {
          try {
            const ctxKeys = Object.keys(ctx);
            const extraKeys = Object.keys(extra);
            const allKeys = [...ctxKeys, ...extraKeys];
            const allValues = allKeys.map(k => {
              if (extra.hasOwnProperty(k)) return unwrap(extra[k]);
              return unwrap(ctx[k]);
            });
            const fn = new Function(...allKeys, 'with(this) { return ' + expr + ' }');
            return fn.call(window.Math || {}, ...allValues);
          } catch (e) {
            return undefined;
          }
        }
        
        function setRef(path, value) {
          if (path.includes('.')) {
            const parts = path.split('.');
            const mainKey = parts[0];
            const subKey = parts.slice(1).join('.');
            let obj = ctx[mainKey];
            if (obj && obj.__v_isRef) {
              obj = obj.value;
            }
            if (obj && typeof obj === 'object') {
              const keys = subKey.split('.');
              let target = obj;
              for (let i = 0; i < keys.length - 1; i++) {
                target = target[keys[i]];
                if (!target) return;
              }
              target[keys[keys.length - 1]] = value;
              if (ctx[mainKey] && ctx[mainKey].__v_isRef) {
                ctx[mainKey].$set({ ...obj }, false);
              }
            }
          } else if (ctx[path] && ctx[path].__v_isRef) {
            ctx[path].value = value;
          }
          scheduleRender();
        }
        
        function render() {
          const inputValues = {};
          const inputs = container.querySelectorAll('input, textarea, select');
          inputs.forEach((input, i) => {
            const key = input.name || input.id || `__input_${i}`;
            if (input.type === 'checkbox' || input.type === 'radio') {
              inputValues[key] = input.checked;
            } else {
              inputValues[key] = input.value;
            }
          });
          
          container.innerHTML = originalHTML;
          
          function process(el, extra = {}) {
            if (el.nodeType === 3) {
              const text = el.textContent;
              if (text.includes('{{')) {
                let result = text;
                const regex = /\{\{(.+?)\}\}/g;
                let match;
                while ((match = regex.exec(text)) !== null) {
                  const value = evaluate(match[1].trim(), extra);
                  result = result.replace(match[0], value !== undefined ? value : '');
                }
                el.textContent = result;
              }
              return;
            }
            
            if (el.nodeType !== 1) return;
            
            const attrs = Array.from(el.attributes);
            let vIf = null;
            let vElse = false;
            let vFor = null;
            let vModel = null;
            const vBinds = {};
            const events = {};
            
            for (const attr of attrs) {
              if (attr.name === 'v-if') vIf = attr.value;
              else if (attr.name === 'v-else') vElse = true;
              else if (attr.name === 'v-for') vFor = attr.value;
              else if (attr.name === 'v-model') vModel = attr.value;
              else if (attr.name.startsWith('@')) {
                const eventName = attr.name.slice(1).split('.')[0];
                events[eventName] = attr.value;
              }
              else if (attr.name.startsWith(':')) vBinds[attr.name.slice(1)] = attr.value;
              else if (attr.name.startsWith('v-bind:')) vBinds[attr.name.slice(7)] = attr.value;
              else if (attr.name.startsWith('v-on:')) {
                const eventName = attr.name.slice(5).split('.')[0];
                events[eventName] = attr.value;
              }
            }
            
            if (vElse) {
              const prev = el.previousElementSibling;
              if (prev && prev.hasAttribute('v-if')) {
                const prevExpr = prev.getAttribute('v-if');
                const prevResult = evaluate(prevExpr, extra);
                el.style.display = prevResult ? 'none' : '';
              }
            }
            
            if (vIf) {
              const result = evaluate(vIf, extra);
              el.style.display = result ? '' : 'none';
            }
            
            if (vFor) {
              const match = vFor.match(/(\w+)\s+in\s+(.+)/);
              if (match) {
                const [, itemName, listExpr] = match;
                let list = evaluate(listExpr, extra) || [];
                if (typeof list === 'number') {
                  list = Array.from({ length: list }, (_, i) => i + 1);
                }
                
                const parent = el.parentNode;
                const template = el.cloneNode(true);
                template.removeAttribute('v-for');
                
                const placeholder = document.createComment('v-for');
                parent.insertBefore(placeholder, el);
                parent.removeChild(el);
                
                list.forEach((item, index) => {
                  const clone = template.cloneNode(true);
                  const itemExtra = { ...extra, [itemName]: item, index };
                  parent.insertBefore(clone, placeholder);
                  process(clone, itemExtra);
                });
                
                parent.removeChild(placeholder);
                return;
              }
            }
            
            for (const [event, expr] of Object.entries(events)) {
              el.addEventListener(event, (e) => {
                const assignMatch = expr.match(/^(\w+(?:\.\w+)*)\s*=\s*(.+)$/);
                if (assignMatch) {
                  const [, targetPath, valueExpr] = assignMatch;
                  const value = evaluate(valueExpr, { ...extra, $event: e });
                  setRef(targetPath, value);
                  return;
                }
                
                if (expr.includes('(')) {
                  evaluate(expr, { ...extra, $event: e });
                } else {
                  const fn = ctx[expr];
                  if (typeof fn === 'function') {
                    fn();
                  } else if (fn !== undefined) {
                    evaluate(expr, { ...extra, $event: e });
                  }
                }
              });
            }
            
            for (const [arg, expr] of Object.entries(vBinds)) {
              const value = evaluate(expr, extra);
              if (arg === 'class') {
                if (typeof value === 'object') {
                  el.className = Object.entries(value)
                    .filter(([k, v]) => v)
                    .map(([k]) => k)
                    .join(' ');
                } else {
                  el.className = value || '';
                }
              } else if (arg === 'value') {
                el.value = value !== undefined ? value : '';
              } else {
                el.setAttribute(arg, value);
              }
            }
            
            if (vModel) {
              el.addEventListener('input', (e) => {
                let val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
                if (vModel.includes('.')) {
                  const parts = vModel.split('.');
                  const mainKey = parts[0];
                  let obj = ctx[mainKey];
                  if (obj && obj.__v_isRef) {
                    obj = obj.value;
                  }
                  if (obj && typeof obj === 'object') {
                    const keys = parts.slice(1);
                    let target = obj;
                    for (let i = 0; i < keys.length - 1; i++) {
                      target = target[keys[i]];
                      if (!target) return;
                    }
                    target[keys[keys.length - 1]] = val;
                    if (ctx[mainKey] && ctx[mainKey].__v_isRef) {
                      ctx[mainKey].$set({ ...obj }, true);
                    }
                  }
                } else if (ctx[vModel] && ctx[vModel].__v_isRef) {
                  ctx[vModel].$set(val, true);
                }
              });
              el.addEventListener('change', (e) => {
                let val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
                setRef(vModel, val);
              });
              el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                  let val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
                  setRef(vModel, val);
                }
              });
              const value = evaluate(vModel, extra);
              if (el.type === 'checkbox') {
                el.checked = !!value;
              } else if (document.activeElement !== el) {
                el.value = value !== undefined ? value : '';
              }
            }
            
            Array.from(el.childNodes).forEach(child => process(child, extra));
          }
          
          process(container);
          
          const newInputs = container.querySelectorAll('input, textarea, select');
          newInputs.forEach((input, i) => {
            const key = input.name || input.id || `__input_${i}`;
            if (inputValues.hasOwnProperty(key)) {
              if (input.type === 'checkbox' || input.type === 'radio') {
                input.checked = inputValues[key];
              } else {
                input.value = inputValues[key];
              }
            }
          });
        }
        
        let isRendering = false;
        function scheduleRender() {
          if (isRendering) return;
          isRendering = true;
          queueMicrotask(() => {
            isRendering = false;
            render();
          });
        }
        window.scheduleRenderFallback = scheduleRender;
        
        const originalEffect = effect;
        effect = function(fn, opts = {}) {
          return originalEffect(fn, {
            ...opts,
            scheduler: opts.scheduler || scheduleRender
          });
        };
        
        effect(render);
        
        setTimeout(() => {
          mountedHooks.forEach(fn => fn());
        }, 0);
        
        return ctx;
      }
    };
  }
  
  global.Vue = {
    createApp,
    ref,
    computed,
    onMounted,
    effect,
    reactive: (obj) => obj
  };
  
})(typeof window !== 'undefined' ? window : global);
