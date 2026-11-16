var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../admin/node_modules/.pnpm/@jsquash+webp@1.5.0/node_modules/@jsquash/webp/codec/enc/webp_enc_simd.js
var webp_enc_simd_exports = {};
__export(webp_enc_simd_exports, {
  default: () => webp_enc_simd_default
});
var Module, webp_enc_simd_default;
var init_webp_enc_simd = __esm({
  "../admin/node_modules/.pnpm/@jsquash+webp@1.5.0/node_modules/@jsquash/webp/codec/enc/webp_enc_simd.js"() {
    Module = (() => {
      var _scriptDir = import.meta.url;
      return (function(Module3 = {}) {
        var Module3 = typeof Module3 != "undefined" ? Module3 : {};
        var readyPromiseResolve, readyPromiseReject;
        Module3["ready"] = new Promise(function(resolve, reject) {
          readyPromiseResolve = resolve;
          readyPromiseReject = reject;
        });
        const isServiceWorker4 = globalThis.ServiceWorkerGlobalScope !== void 0;
        const isRunningInCloudFlareWorkers4 = isServiceWorker4 && typeof self !== "undefined" && caches.default !== void 0;
        if (isRunningInCloudFlareWorkers4) {
          if (!globalThis.ImageData) {
            globalThis.ImageData = class ImageData {
              constructor(data, width, height) {
                this.data = data;
                this.width = width;
                this.height = height;
              }
            };
          }
          if (import.meta.url === void 0) {
            import.meta.url = "https://localhost";
          }
          if (self.location === void 0) {
            self.location = { href: "" };
          }
        }
        var moduleOverrides = Object.assign({}, Module3);
        var arguments_ = [];
        var thisProgram = "./this.program";
        var quit_ = (status, toThrow) => {
          throw toThrow;
        };
        var ENVIRONMENT_IS_WEB = typeof window == "object";
        var ENVIRONMENT_IS_WORKER = typeof importScripts == "function";
        var ENVIRONMENT_IS_NODE = typeof process == "object" && typeof process.versions == "object" && typeof process.versions.node == "string";
        var scriptDirectory = "";
        function locateFile(path) {
          if (Module3["locateFile"]) {
            return Module3["locateFile"](path, scriptDirectory);
          }
          return scriptDirectory + path;
        }
        var read_, readAsync, readBinary, setWindowTitle;
        if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
          if (ENVIRONMENT_IS_WORKER) {
            scriptDirectory = self.location.href;
          } else if (typeof document != "undefined" && document.currentScript) {
            scriptDirectory = document.currentScript.src;
          }
          if (_scriptDir) {
            scriptDirectory = _scriptDir;
          }
          if (scriptDirectory.indexOf("blob:") !== 0) {
            scriptDirectory = scriptDirectory.substr(0, scriptDirectory.replace(/[?#].*/, "").lastIndexOf("/") + 1);
          } else {
            scriptDirectory = "";
          }
          {
            read_ = (url) => {
              var xhr = new XMLHttpRequest();
              xhr.open("GET", url, false);
              xhr.send(null);
              return xhr.responseText;
            };
            if (ENVIRONMENT_IS_WORKER) {
              readBinary = (url) => {
                var xhr = new XMLHttpRequest();
                xhr.open("GET", url, false);
                xhr.responseType = "arraybuffer";
                xhr.send(null);
                return new Uint8Array(xhr.response);
              };
            }
            readAsync = (url, onload, onerror) => {
              var xhr = new XMLHttpRequest();
              xhr.open("GET", url, true);
              xhr.responseType = "arraybuffer";
              xhr.onload = () => {
                if (xhr.status == 200 || xhr.status == 0 && xhr.response) {
                  onload(xhr.response);
                  return;
                }
                onerror();
              };
              xhr.onerror = onerror;
              xhr.send(null);
            };
          }
          setWindowTitle = (title) => document.title = title;
        } else {
        }
        var out = Module3["print"] || console.log.bind(console);
        var err = Module3["printErr"] || console.warn.bind(console);
        Object.assign(Module3, moduleOverrides);
        moduleOverrides = null;
        if (Module3["arguments"]) arguments_ = Module3["arguments"];
        if (Module3["thisProgram"]) thisProgram = Module3["thisProgram"];
        if (Module3["quit"]) quit_ = Module3["quit"];
        var wasmBinary;
        if (Module3["wasmBinary"]) wasmBinary = Module3["wasmBinary"];
        var noExitRuntime = Module3["noExitRuntime"] || true;
        if (typeof WebAssembly != "object") {
          abort("no native wasm support detected");
        }
        var wasmMemory;
        var ABORT = false;
        var EXITSTATUS;
        function UTF8ArrayToString(heapOrArray, idx, maxBytesToRead) {
          var endIdx = idx + maxBytesToRead;
          var str = "";
          while (!(idx >= endIdx)) {
            var u0 = heapOrArray[idx++];
            if (!u0) return str;
            if (!(u0 & 128)) {
              str += String.fromCharCode(u0);
              continue;
            }
            var u1 = heapOrArray[idx++] & 63;
            if ((u0 & 224) == 192) {
              str += String.fromCharCode((u0 & 31) << 6 | u1);
              continue;
            }
            var u2 = heapOrArray[idx++] & 63;
            if ((u0 & 240) == 224) {
              u0 = (u0 & 15) << 12 | u1 << 6 | u2;
            } else {
              u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | heapOrArray[idx++] & 63;
            }
            if (u0 < 65536) {
              str += String.fromCharCode(u0);
            } else {
              var ch = u0 - 65536;
              str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
            }
          }
          return str;
        }
        function UTF8ToString(ptr, maxBytesToRead) {
          return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : "";
        }
        function stringToUTF8Array(str, heap, outIdx, maxBytesToWrite) {
          if (!(maxBytesToWrite > 0)) return 0;
          var startIdx = outIdx;
          var endIdx = outIdx + maxBytesToWrite - 1;
          for (var i = 0; i < str.length; ++i) {
            var u = str.charCodeAt(i);
            if (u >= 55296 && u <= 57343) {
              var u1 = str.charCodeAt(++i);
              u = 65536 + ((u & 1023) << 10) | u1 & 1023;
            }
            if (u <= 127) {
              if (outIdx >= endIdx) break;
              heap[outIdx++] = u;
            } else if (u <= 2047) {
              if (outIdx + 1 >= endIdx) break;
              heap[outIdx++] = 192 | u >> 6;
              heap[outIdx++] = 128 | u & 63;
            } else if (u <= 65535) {
              if (outIdx + 2 >= endIdx) break;
              heap[outIdx++] = 224 | u >> 12;
              heap[outIdx++] = 128 | u >> 6 & 63;
              heap[outIdx++] = 128 | u & 63;
            } else {
              if (outIdx + 3 >= endIdx) break;
              heap[outIdx++] = 240 | u >> 18;
              heap[outIdx++] = 128 | u >> 12 & 63;
              heap[outIdx++] = 128 | u >> 6 & 63;
              heap[outIdx++] = 128 | u & 63;
            }
          }
          heap[outIdx] = 0;
          return outIdx - startIdx;
        }
        function stringToUTF8(str, outPtr, maxBytesToWrite) {
          return stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
        }
        function lengthBytesUTF8(str) {
          var len = 0;
          for (var i = 0; i < str.length; ++i) {
            var c = str.charCodeAt(i);
            if (c <= 127) {
              len++;
            } else if (c <= 2047) {
              len += 2;
            } else if (c >= 55296 && c <= 57343) {
              len += 4;
              ++i;
            } else {
              len += 3;
            }
          }
          return len;
        }
        var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;
        function updateMemoryViews() {
          var b = wasmMemory.buffer;
          Module3["HEAP8"] = HEAP8 = new Int8Array(b);
          Module3["HEAP16"] = HEAP16 = new Int16Array(b);
          Module3["HEAP32"] = HEAP32 = new Int32Array(b);
          Module3["HEAPU8"] = HEAPU8 = new Uint8Array(b);
          Module3["HEAPU16"] = HEAPU16 = new Uint16Array(b);
          Module3["HEAPU32"] = HEAPU32 = new Uint32Array(b);
          Module3["HEAPF32"] = HEAPF32 = new Float32Array(b);
          Module3["HEAPF64"] = HEAPF64 = new Float64Array(b);
        }
        var wasmTable;
        var __ATPRERUN__ = [];
        var __ATINIT__ = [];
        var __ATPOSTRUN__ = [];
        var runtimeInitialized = false;
        function preRun() {
          if (Module3["preRun"]) {
            if (typeof Module3["preRun"] == "function") Module3["preRun"] = [Module3["preRun"]];
            while (Module3["preRun"].length) {
              addOnPreRun(Module3["preRun"].shift());
            }
          }
          callRuntimeCallbacks(__ATPRERUN__);
        }
        function initRuntime() {
          runtimeInitialized = true;
          callRuntimeCallbacks(__ATINIT__);
        }
        function postRun() {
          if (Module3["postRun"]) {
            if (typeof Module3["postRun"] == "function") Module3["postRun"] = [Module3["postRun"]];
            while (Module3["postRun"].length) {
              addOnPostRun(Module3["postRun"].shift());
            }
          }
          callRuntimeCallbacks(__ATPOSTRUN__);
        }
        function addOnPreRun(cb) {
          __ATPRERUN__.unshift(cb);
        }
        function addOnInit(cb) {
          __ATINIT__.unshift(cb);
        }
        function addOnPostRun(cb) {
          __ATPOSTRUN__.unshift(cb);
        }
        var runDependencies = 0;
        var runDependencyWatcher = null;
        var dependenciesFulfilled = null;
        function addRunDependency(id) {
          runDependencies++;
          if (Module3["monitorRunDependencies"]) {
            Module3["monitorRunDependencies"](runDependencies);
          }
        }
        function removeRunDependency(id) {
          runDependencies--;
          if (Module3["monitorRunDependencies"]) {
            Module3["monitorRunDependencies"](runDependencies);
          }
          if (runDependencies == 0) {
            if (runDependencyWatcher !== null) {
              clearInterval(runDependencyWatcher);
              runDependencyWatcher = null;
            }
            if (dependenciesFulfilled) {
              var callback = dependenciesFulfilled;
              dependenciesFulfilled = null;
              callback();
            }
          }
        }
        function abort(what) {
          if (Module3["onAbort"]) {
            Module3["onAbort"](what);
          }
          what = "Aborted(" + what + ")";
          err(what);
          ABORT = true;
          EXITSTATUS = 1;
          what += ". Build with -sASSERTIONS for more info.";
          var e = new WebAssembly.RuntimeError(what);
          readyPromiseReject(e);
          throw e;
        }
        var dataURIPrefix = "data:application/octet-stream;base64,";
        function isDataURI(filename) {
          return filename.startsWith(dataURIPrefix);
        }
        var wasmBinaryFile;
        if (Module3["locateFile"]) {
          wasmBinaryFile = "webp_enc_simd.wasm";
          if (!isDataURI(wasmBinaryFile)) {
            wasmBinaryFile = locateFile(wasmBinaryFile);
          }
        } else {
          wasmBinaryFile = new URL("webp_enc_simd.wasm", import.meta.url).href;
        }
        function getBinary(file) {
          try {
            if (file == wasmBinaryFile && wasmBinary) {
              return new Uint8Array(wasmBinary);
            }
            if (readBinary) {
              return readBinary(file);
            }
            throw "both async and sync fetching of the wasm failed";
          } catch (err2) {
            abort(err2);
          }
        }
        function getBinaryPromise(binaryFile) {
          if (!wasmBinary && (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER)) {
            if (typeof fetch == "function") {
              return fetch(binaryFile, { credentials: "same-origin" }).then(function(response) {
                if (!response["ok"]) {
                  throw "failed to load wasm binary file at '" + binaryFile + "'";
                }
                return response["arrayBuffer"]();
              }).catch(function() {
                return getBinary(binaryFile);
              });
            }
          }
          return Promise.resolve().then(function() {
            return getBinary(binaryFile);
          });
        }
        function instantiateArrayBuffer(binaryFile, imports, receiver) {
          return getBinaryPromise(binaryFile).then(function(binary) {
            return WebAssembly.instantiate(binary, imports);
          }).then(function(instance) {
            return instance;
          }).then(receiver, function(reason) {
            err("failed to asynchronously prepare wasm: " + reason);
            abort(reason);
          });
        }
        function instantiateAsync(binary, binaryFile, imports, callback) {
          if (!binary && typeof WebAssembly.instantiateStreaming == "function" && !isDataURI(binaryFile) && typeof fetch == "function") {
            return fetch(binaryFile, { credentials: "same-origin" }).then(function(response) {
              var result = WebAssembly.instantiateStreaming(response, imports);
              return result.then(callback, function(reason) {
                err("wasm streaming compile failed: " + reason);
                err("falling back to ArrayBuffer instantiation");
                return instantiateArrayBuffer(binaryFile, imports, callback);
              });
            });
          } else {
            return instantiateArrayBuffer(binaryFile, imports, callback);
          }
        }
        function createWasm() {
          var info = { "a": wasmImports };
          function receiveInstance(instance, module) {
            var exports = instance.exports;
            Module3["asm"] = exports;
            wasmMemory = Module3["asm"]["x"];
            updateMemoryViews();
            wasmTable = Module3["asm"]["D"];
            addOnInit(Module3["asm"]["y"]);
            removeRunDependency("wasm-instantiate");
            return exports;
          }
          addRunDependency("wasm-instantiate");
          function receiveInstantiationResult(result) {
            receiveInstance(result["instance"]);
          }
          if (Module3["instantiateWasm"]) {
            try {
              return Module3["instantiateWasm"](info, receiveInstance);
            } catch (e) {
              err("Module.instantiateWasm callback failed with error: " + e);
              readyPromiseReject(e);
            }
          }
          instantiateAsync(wasmBinary, wasmBinaryFile, info, receiveInstantiationResult).catch(readyPromiseReject);
          return {};
        }
        function callRuntimeCallbacks(callbacks) {
          while (callbacks.length > 0) {
            callbacks.shift()(Module3);
          }
        }
        function ExceptionInfo(excPtr) {
          this.excPtr = excPtr;
          this.ptr = excPtr - 24;
          this.set_type = function(type) {
            HEAPU32[this.ptr + 4 >> 2] = type;
          };
          this.get_type = function() {
            return HEAPU32[this.ptr + 4 >> 2];
          };
          this.set_destructor = function(destructor) {
            HEAPU32[this.ptr + 8 >> 2] = destructor;
          };
          this.get_destructor = function() {
            return HEAPU32[this.ptr + 8 >> 2];
          };
          this.set_refcount = function(refcount) {
            HEAP32[this.ptr >> 2] = refcount;
          };
          this.set_caught = function(caught) {
            caught = caught ? 1 : 0;
            HEAP8[this.ptr + 12 >> 0] = caught;
          };
          this.get_caught = function() {
            return HEAP8[this.ptr + 12 >> 0] != 0;
          };
          this.set_rethrown = function(rethrown) {
            rethrown = rethrown ? 1 : 0;
            HEAP8[this.ptr + 13 >> 0] = rethrown;
          };
          this.get_rethrown = function() {
            return HEAP8[this.ptr + 13 >> 0] != 0;
          };
          this.init = function(type, destructor) {
            this.set_adjusted_ptr(0);
            this.set_type(type);
            this.set_destructor(destructor);
            this.set_refcount(0);
            this.set_caught(false);
            this.set_rethrown(false);
          };
          this.add_ref = function() {
            var value = HEAP32[this.ptr >> 2];
            HEAP32[this.ptr >> 2] = value + 1;
          };
          this.release_ref = function() {
            var prev = HEAP32[this.ptr >> 2];
            HEAP32[this.ptr >> 2] = prev - 1;
            return prev === 1;
          };
          this.set_adjusted_ptr = function(adjustedPtr) {
            HEAPU32[this.ptr + 16 >> 2] = adjustedPtr;
          };
          this.get_adjusted_ptr = function() {
            return HEAPU32[this.ptr + 16 >> 2];
          };
          this.get_exception_ptr = function() {
            var isPointer = ___cxa_is_pointer_type(this.get_type());
            if (isPointer) {
              return HEAPU32[this.excPtr >> 2];
            }
            var adjusted = this.get_adjusted_ptr();
            if (adjusted !== 0) return adjusted;
            return this.excPtr;
          };
        }
        var exceptionLast = 0;
        var uncaughtExceptionCount = 0;
        function ___cxa_throw(ptr, type, destructor) {
          var info = new ExceptionInfo(ptr);
          info.init(type, destructor);
          exceptionLast = ptr;
          uncaughtExceptionCount++;
          throw ptr;
        }
        var structRegistrations = {};
        function runDestructors(destructors) {
          while (destructors.length) {
            var ptr = destructors.pop();
            var del = destructors.pop();
            del(ptr);
          }
        }
        function simpleReadValueFromPointer(pointer) {
          return this["fromWireType"](HEAP32[pointer >> 2]);
        }
        var awaitingDependencies = {};
        var registeredTypes = {};
        var typeDependencies = {};
        var char_0 = 48;
        var char_9 = 57;
        function makeLegalFunctionName(name) {
          if (void 0 === name) {
            return "_unknown";
          }
          name = name.replace(/[^a-zA-Z0-9_]/g, "$");
          var f = name.charCodeAt(0);
          if (f >= char_0 && f <= char_9) {
            return "_" + name;
          }
          return name;
        }
        function createNamedFunction(name, body) {
          name = makeLegalFunctionName(name);
          return { [name]: function() {
            return body.apply(this, arguments);
          } }[name];
        }
        function extendError(baseErrorType, errorName) {
          var errorClass = createNamedFunction(errorName, function(message) {
            this.name = errorName;
            this.message = message;
            var stack = new Error(message).stack;
            if (stack !== void 0) {
              this.stack = this.toString() + "\n" + stack.replace(/^Error(:[^\n]*)?\n/, "");
            }
          });
          errorClass.prototype = Object.create(baseErrorType.prototype);
          errorClass.prototype.constructor = errorClass;
          errorClass.prototype.toString = function() {
            if (this.message === void 0) {
              return this.name;
            } else {
              return this.name + ": " + this.message;
            }
          };
          return errorClass;
        }
        var InternalError = void 0;
        function throwInternalError(message) {
          throw new InternalError(message);
        }
        function whenDependentTypesAreResolved(myTypes, dependentTypes, getTypeConverters) {
          myTypes.forEach(function(type) {
            typeDependencies[type] = dependentTypes;
          });
          function onComplete(typeConverters2) {
            var myTypeConverters = getTypeConverters(typeConverters2);
            if (myTypeConverters.length !== myTypes.length) {
              throwInternalError("Mismatched type converter count");
            }
            for (var i = 0; i < myTypes.length; ++i) {
              registerType(myTypes[i], myTypeConverters[i]);
            }
          }
          var typeConverters = new Array(dependentTypes.length);
          var unregisteredTypes = [];
          var registered = 0;
          dependentTypes.forEach((dt, i) => {
            if (registeredTypes.hasOwnProperty(dt)) {
              typeConverters[i] = registeredTypes[dt];
            } else {
              unregisteredTypes.push(dt);
              if (!awaitingDependencies.hasOwnProperty(dt)) {
                awaitingDependencies[dt] = [];
              }
              awaitingDependencies[dt].push(() => {
                typeConverters[i] = registeredTypes[dt];
                ++registered;
                if (registered === unregisteredTypes.length) {
                  onComplete(typeConverters);
                }
              });
            }
          });
          if (0 === unregisteredTypes.length) {
            onComplete(typeConverters);
          }
        }
        function __embind_finalize_value_object(structType) {
          var reg = structRegistrations[structType];
          delete structRegistrations[structType];
          var rawConstructor = reg.rawConstructor;
          var rawDestructor = reg.rawDestructor;
          var fieldRecords = reg.fields;
          var fieldTypes = fieldRecords.map((field) => field.getterReturnType).concat(fieldRecords.map((field) => field.setterArgumentType));
          whenDependentTypesAreResolved([structType], fieldTypes, (fieldTypes2) => {
            var fields = {};
            fieldRecords.forEach((field, i) => {
              var fieldName = field.fieldName;
              var getterReturnType = fieldTypes2[i];
              var getter = field.getter;
              var getterContext = field.getterContext;
              var setterArgumentType = fieldTypes2[i + fieldRecords.length];
              var setter = field.setter;
              var setterContext = field.setterContext;
              fields[fieldName] = { read: (ptr) => {
                return getterReturnType["fromWireType"](getter(getterContext, ptr));
              }, write: (ptr, o) => {
                var destructors = [];
                setter(setterContext, ptr, setterArgumentType["toWireType"](destructors, o));
                runDestructors(destructors);
              } };
            });
            return [{ name: reg.name, "fromWireType": function(ptr) {
              var rv = {};
              for (var i in fields) {
                rv[i] = fields[i].read(ptr);
              }
              rawDestructor(ptr);
              return rv;
            }, "toWireType": function(destructors, o) {
              for (var fieldName in fields) {
                if (!(fieldName in o)) {
                  throw new TypeError('Missing field:  "' + fieldName + '"');
                }
              }
              var ptr = rawConstructor();
              for (fieldName in fields) {
                fields[fieldName].write(ptr, o[fieldName]);
              }
              if (destructors !== null) {
                destructors.push(rawDestructor, ptr);
              }
              return ptr;
            }, "argPackAdvance": 8, "readValueFromPointer": simpleReadValueFromPointer, destructorFunction: rawDestructor }];
          });
        }
        function __embind_register_bigint(primitiveType, name, size, minRange, maxRange) {
        }
        function getShiftFromSize(size) {
          switch (size) {
            case 1:
              return 0;
            case 2:
              return 1;
            case 4:
              return 2;
            case 8:
              return 3;
            default:
              throw new TypeError("Unknown type size: " + size);
          }
        }
        function embind_init_charCodes() {
          var codes = new Array(256);
          for (var i = 0; i < 256; ++i) {
            codes[i] = String.fromCharCode(i);
          }
          embind_charCodes = codes;
        }
        var embind_charCodes = void 0;
        function readLatin1String(ptr) {
          var ret = "";
          var c = ptr;
          while (HEAPU8[c]) {
            ret += embind_charCodes[HEAPU8[c++]];
          }
          return ret;
        }
        var BindingError = void 0;
        function throwBindingError(message) {
          throw new BindingError(message);
        }
        function registerType(rawType, registeredInstance, options = {}) {
          if (!("argPackAdvance" in registeredInstance)) {
            throw new TypeError("registerType registeredInstance requires argPackAdvance");
          }
          var name = registeredInstance.name;
          if (!rawType) {
            throwBindingError('type "' + name + '" must have a positive integer typeid pointer');
          }
          if (registeredTypes.hasOwnProperty(rawType)) {
            if (options.ignoreDuplicateRegistrations) {
              return;
            } else {
              throwBindingError("Cannot register type '" + name + "' twice");
            }
          }
          registeredTypes[rawType] = registeredInstance;
          delete typeDependencies[rawType];
          if (awaitingDependencies.hasOwnProperty(rawType)) {
            var callbacks = awaitingDependencies[rawType];
            delete awaitingDependencies[rawType];
            callbacks.forEach((cb) => cb());
          }
        }
        function __embind_register_bool(rawType, name, size, trueValue, falseValue) {
          var shift = getShiftFromSize(size);
          name = readLatin1String(name);
          registerType(rawType, { name, "fromWireType": function(wt) {
            return !!wt;
          }, "toWireType": function(destructors, o) {
            return o ? trueValue : falseValue;
          }, "argPackAdvance": 8, "readValueFromPointer": function(pointer) {
            var heap;
            if (size === 1) {
              heap = HEAP8;
            } else if (size === 2) {
              heap = HEAP16;
            } else if (size === 4) {
              heap = HEAP32;
            } else {
              throw new TypeError("Unknown boolean type size: " + name);
            }
            return this["fromWireType"](heap[pointer >> shift]);
          }, destructorFunction: null });
        }
        var emval_free_list = [];
        var emval_handle_array = [{}, { value: void 0 }, { value: null }, { value: true }, { value: false }];
        function __emval_decref(handle) {
          if (handle > 4 && 0 === --emval_handle_array[handle].refcount) {
            emval_handle_array[handle] = void 0;
            emval_free_list.push(handle);
          }
        }
        function count_emval_handles() {
          var count = 0;
          for (var i = 5; i < emval_handle_array.length; ++i) {
            if (emval_handle_array[i] !== void 0) {
              ++count;
            }
          }
          return count;
        }
        function get_first_emval() {
          for (var i = 5; i < emval_handle_array.length; ++i) {
            if (emval_handle_array[i] !== void 0) {
              return emval_handle_array[i];
            }
          }
          return null;
        }
        function init_emval() {
          Module3["count_emval_handles"] = count_emval_handles;
          Module3["get_first_emval"] = get_first_emval;
        }
        var Emval = { toValue: (handle) => {
          if (!handle) {
            throwBindingError("Cannot use deleted val. handle = " + handle);
          }
          return emval_handle_array[handle].value;
        }, toHandle: (value) => {
          switch (value) {
            case void 0:
              return 1;
            case null:
              return 2;
            case true:
              return 3;
            case false:
              return 4;
            default: {
              var handle = emval_free_list.length ? emval_free_list.pop() : emval_handle_array.length;
              emval_handle_array[handle] = { refcount: 1, value };
              return handle;
            }
          }
        } };
        function __embind_register_emval(rawType, name) {
          name = readLatin1String(name);
          registerType(rawType, { name, "fromWireType": function(handle) {
            var rv = Emval.toValue(handle);
            __emval_decref(handle);
            return rv;
          }, "toWireType": function(destructors, value) {
            return Emval.toHandle(value);
          }, "argPackAdvance": 8, "readValueFromPointer": simpleReadValueFromPointer, destructorFunction: null });
        }
        function ensureOverloadTable(proto, methodName, humanName) {
          if (void 0 === proto[methodName].overloadTable) {
            var prevFunc = proto[methodName];
            proto[methodName] = function() {
              if (!proto[methodName].overloadTable.hasOwnProperty(arguments.length)) {
                throwBindingError("Function '" + humanName + "' called with an invalid number of arguments (" + arguments.length + ") - expects one of (" + proto[methodName].overloadTable + ")!");
              }
              return proto[methodName].overloadTable[arguments.length].apply(this, arguments);
            };
            proto[methodName].overloadTable = [];
            proto[methodName].overloadTable[prevFunc.argCount] = prevFunc;
          }
        }
        function exposePublicSymbol(name, value, numArguments) {
          if (Module3.hasOwnProperty(name)) {
            if (void 0 === numArguments || void 0 !== Module3[name].overloadTable && void 0 !== Module3[name].overloadTable[numArguments]) {
              throwBindingError("Cannot register public name '" + name + "' twice");
            }
            ensureOverloadTable(Module3, name, name);
            if (Module3.hasOwnProperty(numArguments)) {
              throwBindingError("Cannot register multiple overloads of a function with the same number of arguments (" + numArguments + ")!");
            }
            Module3[name].overloadTable[numArguments] = value;
          } else {
            Module3[name] = value;
            if (void 0 !== numArguments) {
              Module3[name].numArguments = numArguments;
            }
          }
        }
        function enumReadValueFromPointer(name, shift, signed) {
          switch (shift) {
            case 0:
              return function(pointer) {
                var heap = signed ? HEAP8 : HEAPU8;
                return this["fromWireType"](heap[pointer]);
              };
            case 1:
              return function(pointer) {
                var heap = signed ? HEAP16 : HEAPU16;
                return this["fromWireType"](heap[pointer >> 1]);
              };
            case 2:
              return function(pointer) {
                var heap = signed ? HEAP32 : HEAPU32;
                return this["fromWireType"](heap[pointer >> 2]);
              };
            default:
              throw new TypeError("Unknown integer type: " + name);
          }
        }
        function __embind_register_enum(rawType, name, size, isSigned) {
          var shift = getShiftFromSize(size);
          name = readLatin1String(name);
          function ctor() {
          }
          ctor.values = {};
          registerType(rawType, { name, constructor: ctor, "fromWireType": function(c) {
            return this.constructor.values[c];
          }, "toWireType": function(destructors, c) {
            return c.value;
          }, "argPackAdvance": 8, "readValueFromPointer": enumReadValueFromPointer(name, shift, isSigned), destructorFunction: null });
          exposePublicSymbol(name, ctor);
        }
        function getTypeName(type) {
          var ptr = ___getTypeName(type);
          var rv = readLatin1String(ptr);
          _free(ptr);
          return rv;
        }
        function requireRegisteredType(rawType, humanName) {
          var impl = registeredTypes[rawType];
          if (void 0 === impl) {
            throwBindingError(humanName + " has unknown type " + getTypeName(rawType));
          }
          return impl;
        }
        function __embind_register_enum_value(rawEnumType, name, enumValue) {
          var enumType = requireRegisteredType(rawEnumType, "enum");
          name = readLatin1String(name);
          var Enum = enumType.constructor;
          var Value = Object.create(enumType.constructor.prototype, { value: { value: enumValue }, constructor: { value: createNamedFunction(enumType.name + "_" + name, function() {
          }) } });
          Enum.values[enumValue] = Value;
          Enum[name] = Value;
        }
        function floatReadValueFromPointer(name, shift) {
          switch (shift) {
            case 2:
              return function(pointer) {
                return this["fromWireType"](HEAPF32[pointer >> 2]);
              };
            case 3:
              return function(pointer) {
                return this["fromWireType"](HEAPF64[pointer >> 3]);
              };
            default:
              throw new TypeError("Unknown float type: " + name);
          }
        }
        function __embind_register_float(rawType, name, size) {
          var shift = getShiftFromSize(size);
          name = readLatin1String(name);
          registerType(rawType, { name, "fromWireType": function(value) {
            return value;
          }, "toWireType": function(destructors, value) {
            return value;
          }, "argPackAdvance": 8, "readValueFromPointer": floatReadValueFromPointer(name, shift), destructorFunction: null });
        }
        function craftInvokerFunction(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc, isAsync) {
          var argCount = argTypes.length;
          if (argCount < 2) {
            throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!");
          }
          var isClassMethodFunc = argTypes[1] !== null && classType !== null;
          var needsDestructorStack = false;
          for (var i = 1; i < argTypes.length; ++i) {
            if (argTypes[i] !== null && argTypes[i].destructorFunction === void 0) {
              needsDestructorStack = true;
              break;
            }
          }
          var returns = argTypes[0].name !== "void";
          var expectedArgCount = argCount - 2;
          var argsWired = new Array(expectedArgCount);
          var invokerFuncArgs = [];
          var destructors = [];
          return function() {
            if (arguments.length !== expectedArgCount) {
              throwBindingError("function " + humanName + " called with " + arguments.length + " arguments, expected " + expectedArgCount + " args!");
            }
            destructors.length = 0;
            var thisWired;
            invokerFuncArgs.length = isClassMethodFunc ? 2 : 1;
            invokerFuncArgs[0] = cppTargetFunc;
            if (isClassMethodFunc) {
              thisWired = argTypes[1]["toWireType"](destructors, this);
              invokerFuncArgs[1] = thisWired;
            }
            for (var i2 = 0; i2 < expectedArgCount; ++i2) {
              argsWired[i2] = argTypes[i2 + 2]["toWireType"](destructors, arguments[i2]);
              invokerFuncArgs.push(argsWired[i2]);
            }
            var rv = cppInvokerFunc.apply(null, invokerFuncArgs);
            function onDone(rv2) {
              if (needsDestructorStack) {
                runDestructors(destructors);
              } else {
                for (var i3 = isClassMethodFunc ? 1 : 2; i3 < argTypes.length; i3++) {
                  var param = i3 === 1 ? thisWired : argsWired[i3 - 2];
                  if (argTypes[i3].destructorFunction !== null) {
                    argTypes[i3].destructorFunction(param);
                  }
                }
              }
              if (returns) {
                return argTypes[0]["fromWireType"](rv2);
              }
            }
            return onDone(rv);
          };
        }
        function heap32VectorToArray(count, firstElement) {
          var array = [];
          for (var i = 0; i < count; i++) {
            array.push(HEAPU32[firstElement + i * 4 >> 2]);
          }
          return array;
        }
        function replacePublicSymbol(name, value, numArguments) {
          if (!Module3.hasOwnProperty(name)) {
            throwInternalError("Replacing nonexistant public symbol");
          }
          if (void 0 !== Module3[name].overloadTable && void 0 !== numArguments) {
            Module3[name].overloadTable[numArguments] = value;
          } else {
            Module3[name] = value;
            Module3[name].argCount = numArguments;
          }
        }
        function dynCallLegacy(sig, ptr, args) {
          var f = Module3["dynCall_" + sig];
          return args && args.length ? f.apply(null, [ptr].concat(args)) : f.call(null, ptr);
        }
        var wasmTableMirror = [];
        function getWasmTableEntry(funcPtr) {
          var func = wasmTableMirror[funcPtr];
          if (!func) {
            if (funcPtr >= wasmTableMirror.length) wasmTableMirror.length = funcPtr + 1;
            wasmTableMirror[funcPtr] = func = wasmTable.get(funcPtr);
          }
          return func;
        }
        function dynCall(sig, ptr, args) {
          if (sig.includes("j")) {
            return dynCallLegacy(sig, ptr, args);
          }
          var rtn = getWasmTableEntry(ptr).apply(null, args);
          return rtn;
        }
        function getDynCaller(sig, ptr) {
          var argCache = [];
          return function() {
            argCache.length = 0;
            Object.assign(argCache, arguments);
            return dynCall(sig, ptr, argCache);
          };
        }
        function embind__requireFunction(signature, rawFunction) {
          signature = readLatin1String(signature);
          function makeDynCaller() {
            if (signature.includes("j")) {
              return getDynCaller(signature, rawFunction);
            }
            return getWasmTableEntry(rawFunction);
          }
          var fp = makeDynCaller();
          if (typeof fp != "function") {
            throwBindingError("unknown function pointer with signature " + signature + ": " + rawFunction);
          }
          return fp;
        }
        var UnboundTypeError = void 0;
        function throwUnboundTypeError(message, types) {
          var unboundTypes = [];
          var seen = {};
          function visit(type) {
            if (seen[type]) {
              return;
            }
            if (registeredTypes[type]) {
              return;
            }
            if (typeDependencies[type]) {
              typeDependencies[type].forEach(visit);
              return;
            }
            unboundTypes.push(type);
            seen[type] = true;
          }
          types.forEach(visit);
          throw new UnboundTypeError(message + ": " + unboundTypes.map(getTypeName).join([", "]));
        }
        function __embind_register_function(name, argCount, rawArgTypesAddr, signature, rawInvoker, fn, isAsync) {
          var argTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
          name = readLatin1String(name);
          rawInvoker = embind__requireFunction(signature, rawInvoker);
          exposePublicSymbol(name, function() {
            throwUnboundTypeError("Cannot call " + name + " due to unbound types", argTypes);
          }, argCount - 1);
          whenDependentTypesAreResolved([], argTypes, function(argTypes2) {
            var invokerArgsArray = [argTypes2[0], null].concat(argTypes2.slice(1));
            replacePublicSymbol(name, craftInvokerFunction(name, invokerArgsArray, null, rawInvoker, fn, isAsync), argCount - 1);
            return [];
          });
        }
        function integerReadValueFromPointer(name, shift, signed) {
          switch (shift) {
            case 0:
              return signed ? function readS8FromPointer(pointer) {
                return HEAP8[pointer];
              } : function readU8FromPointer(pointer) {
                return HEAPU8[pointer];
              };
            case 1:
              return signed ? function readS16FromPointer(pointer) {
                return HEAP16[pointer >> 1];
              } : function readU16FromPointer(pointer) {
                return HEAPU16[pointer >> 1];
              };
            case 2:
              return signed ? function readS32FromPointer(pointer) {
                return HEAP32[pointer >> 2];
              } : function readU32FromPointer(pointer) {
                return HEAPU32[pointer >> 2];
              };
            default:
              throw new TypeError("Unknown integer type: " + name);
          }
        }
        function __embind_register_integer(primitiveType, name, size, minRange, maxRange) {
          name = readLatin1String(name);
          if (maxRange === -1) {
            maxRange = 4294967295;
          }
          var shift = getShiftFromSize(size);
          var fromWireType = (value) => value;
          if (minRange === 0) {
            var bitshift = 32 - 8 * size;
            fromWireType = (value) => value << bitshift >>> bitshift;
          }
          var isUnsignedType = name.includes("unsigned");
          var checkAssertions = (value, toTypeName) => {
          };
          var toWireType;
          if (isUnsignedType) {
            toWireType = function(destructors, value) {
              checkAssertions(value, this.name);
              return value >>> 0;
            };
          } else {
            toWireType = function(destructors, value) {
              checkAssertions(value, this.name);
              return value;
            };
          }
          registerType(primitiveType, { name, "fromWireType": fromWireType, "toWireType": toWireType, "argPackAdvance": 8, "readValueFromPointer": integerReadValueFromPointer(name, shift, minRange !== 0), destructorFunction: null });
        }
        function __embind_register_memory_view(rawType, dataTypeIndex, name) {
          var typeMapping = [Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array];
          var TA = typeMapping[dataTypeIndex];
          function decodeMemoryView(handle) {
            handle = handle >> 2;
            var heap = HEAPU32;
            var size = heap[handle];
            var data = heap[handle + 1];
            return new TA(heap.buffer, data, size);
          }
          name = readLatin1String(name);
          registerType(rawType, { name, "fromWireType": decodeMemoryView, "argPackAdvance": 8, "readValueFromPointer": decodeMemoryView }, { ignoreDuplicateRegistrations: true });
        }
        function __embind_register_std_string(rawType, name) {
          name = readLatin1String(name);
          var stdStringIsUTF8 = name === "std::string";
          registerType(rawType, { name, "fromWireType": function(value) {
            var length = HEAPU32[value >> 2];
            var payload = value + 4;
            var str;
            if (stdStringIsUTF8) {
              var decodeStartPtr = payload;
              for (var i = 0; i <= length; ++i) {
                var currentBytePtr = payload + i;
                if (i == length || HEAPU8[currentBytePtr] == 0) {
                  var maxRead = currentBytePtr - decodeStartPtr;
                  var stringSegment = UTF8ToString(decodeStartPtr, maxRead);
                  if (str === void 0) {
                    str = stringSegment;
                  } else {
                    str += String.fromCharCode(0);
                    str += stringSegment;
                  }
                  decodeStartPtr = currentBytePtr + 1;
                }
              }
            } else {
              var a = new Array(length);
              for (var i = 0; i < length; ++i) {
                a[i] = String.fromCharCode(HEAPU8[payload + i]);
              }
              str = a.join("");
            }
            _free(value);
            return str;
          }, "toWireType": function(destructors, value) {
            if (value instanceof ArrayBuffer) {
              value = new Uint8Array(value);
            }
            var length;
            var valueIsOfTypeString = typeof value == "string";
            if (!(valueIsOfTypeString || value instanceof Uint8Array || value instanceof Uint8ClampedArray || value instanceof Int8Array)) {
              throwBindingError("Cannot pass non-string to std::string");
            }
            if (stdStringIsUTF8 && valueIsOfTypeString) {
              length = lengthBytesUTF8(value);
            } else {
              length = value.length;
            }
            var base = _malloc(4 + length + 1);
            var ptr = base + 4;
            HEAPU32[base >> 2] = length;
            if (stdStringIsUTF8 && valueIsOfTypeString) {
              stringToUTF8(value, ptr, length + 1);
            } else {
              if (valueIsOfTypeString) {
                for (var i = 0; i < length; ++i) {
                  var charCode = value.charCodeAt(i);
                  if (charCode > 255) {
                    _free(ptr);
                    throwBindingError("String has UTF-16 code units that do not fit in 8 bits");
                  }
                  HEAPU8[ptr + i] = charCode;
                }
              } else {
                for (var i = 0; i < length; ++i) {
                  HEAPU8[ptr + i] = value[i];
                }
              }
            }
            if (destructors !== null) {
              destructors.push(_free, base);
            }
            return base;
          }, "argPackAdvance": 8, "readValueFromPointer": simpleReadValueFromPointer, destructorFunction: function(ptr) {
            _free(ptr);
          } });
        }
        function UTF16ToString(ptr, maxBytesToRead) {
          var str = "";
          for (var i = 0; !(i >= maxBytesToRead / 2); ++i) {
            var codeUnit = HEAP16[ptr + i * 2 >> 1];
            if (codeUnit == 0) break;
            str += String.fromCharCode(codeUnit);
          }
          return str;
        }
        function stringToUTF16(str, outPtr, maxBytesToWrite) {
          if (maxBytesToWrite === void 0) {
            maxBytesToWrite = 2147483647;
          }
          if (maxBytesToWrite < 2) return 0;
          maxBytesToWrite -= 2;
          var startPtr = outPtr;
          var numCharsToWrite = maxBytesToWrite < str.length * 2 ? maxBytesToWrite / 2 : str.length;
          for (var i = 0; i < numCharsToWrite; ++i) {
            var codeUnit = str.charCodeAt(i);
            HEAP16[outPtr >> 1] = codeUnit;
            outPtr += 2;
          }
          HEAP16[outPtr >> 1] = 0;
          return outPtr - startPtr;
        }
        function lengthBytesUTF16(str) {
          return str.length * 2;
        }
        function UTF32ToString(ptr, maxBytesToRead) {
          var i = 0;
          var str = "";
          while (!(i >= maxBytesToRead / 4)) {
            var utf32 = HEAP32[ptr + i * 4 >> 2];
            if (utf32 == 0) break;
            ++i;
            if (utf32 >= 65536) {
              var ch = utf32 - 65536;
              str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
            } else {
              str += String.fromCharCode(utf32);
            }
          }
          return str;
        }
        function stringToUTF32(str, outPtr, maxBytesToWrite) {
          if (maxBytesToWrite === void 0) {
            maxBytesToWrite = 2147483647;
          }
          if (maxBytesToWrite < 4) return 0;
          var startPtr = outPtr;
          var endPtr = startPtr + maxBytesToWrite - 4;
          for (var i = 0; i < str.length; ++i) {
            var codeUnit = str.charCodeAt(i);
            if (codeUnit >= 55296 && codeUnit <= 57343) {
              var trailSurrogate = str.charCodeAt(++i);
              codeUnit = 65536 + ((codeUnit & 1023) << 10) | trailSurrogate & 1023;
            }
            HEAP32[outPtr >> 2] = codeUnit;
            outPtr += 4;
            if (outPtr + 4 > endPtr) break;
          }
          HEAP32[outPtr >> 2] = 0;
          return outPtr - startPtr;
        }
        function lengthBytesUTF32(str) {
          var len = 0;
          for (var i = 0; i < str.length; ++i) {
            var codeUnit = str.charCodeAt(i);
            if (codeUnit >= 55296 && codeUnit <= 57343) ++i;
            len += 4;
          }
          return len;
        }
        function __embind_register_std_wstring(rawType, charSize, name) {
          name = readLatin1String(name);
          var decodeString, encodeString, getHeap, lengthBytesUTF, shift;
          if (charSize === 2) {
            decodeString = UTF16ToString;
            encodeString = stringToUTF16;
            lengthBytesUTF = lengthBytesUTF16;
            getHeap = () => HEAPU16;
            shift = 1;
          } else if (charSize === 4) {
            decodeString = UTF32ToString;
            encodeString = stringToUTF32;
            lengthBytesUTF = lengthBytesUTF32;
            getHeap = () => HEAPU32;
            shift = 2;
          }
          registerType(rawType, { name, "fromWireType": function(value) {
            var length = HEAPU32[value >> 2];
            var HEAP = getHeap();
            var str;
            var decodeStartPtr = value + 4;
            for (var i = 0; i <= length; ++i) {
              var currentBytePtr = value + 4 + i * charSize;
              if (i == length || HEAP[currentBytePtr >> shift] == 0) {
                var maxReadBytes = currentBytePtr - decodeStartPtr;
                var stringSegment = decodeString(decodeStartPtr, maxReadBytes);
                if (str === void 0) {
                  str = stringSegment;
                } else {
                  str += String.fromCharCode(0);
                  str += stringSegment;
                }
                decodeStartPtr = currentBytePtr + charSize;
              }
            }
            _free(value);
            return str;
          }, "toWireType": function(destructors, value) {
            if (!(typeof value == "string")) {
              throwBindingError("Cannot pass non-string to C++ string type " + name);
            }
            var length = lengthBytesUTF(value);
            var ptr = _malloc(4 + length + charSize);
            HEAPU32[ptr >> 2] = length >> shift;
            encodeString(value, ptr + 4, length + charSize);
            if (destructors !== null) {
              destructors.push(_free, ptr);
            }
            return ptr;
          }, "argPackAdvance": 8, "readValueFromPointer": simpleReadValueFromPointer, destructorFunction: function(ptr) {
            _free(ptr);
          } });
        }
        function __embind_register_value_object(rawType, name, constructorSignature, rawConstructor, destructorSignature, rawDestructor) {
          structRegistrations[rawType] = { name: readLatin1String(name), rawConstructor: embind__requireFunction(constructorSignature, rawConstructor), rawDestructor: embind__requireFunction(destructorSignature, rawDestructor), fields: [] };
        }
        function __embind_register_value_object_field(structType, fieldName, getterReturnType, getterSignature, getter, getterContext, setterArgumentType, setterSignature, setter, setterContext) {
          structRegistrations[structType].fields.push({ fieldName: readLatin1String(fieldName), getterReturnType, getter: embind__requireFunction(getterSignature, getter), getterContext, setterArgumentType, setter: embind__requireFunction(setterSignature, setter), setterContext });
        }
        function __embind_register_void(rawType, name) {
          name = readLatin1String(name);
          registerType(rawType, { isVoid: true, name, "argPackAdvance": 0, "fromWireType": function() {
            return void 0;
          }, "toWireType": function(destructors, o) {
            return void 0;
          } });
        }
        var emval_symbols = {};
        function getStringOrSymbol(address) {
          var symbol = emval_symbols[address];
          if (symbol === void 0) {
            return readLatin1String(address);
          }
          return symbol;
        }
        function emval_get_global() {
          if (typeof globalThis == "object") {
            return globalThis;
          }
          function testGlobal(obj) {
            obj["$$$embind_global$$$"] = obj;
            var success = typeof $$$embind_global$$$ == "object" && obj["$$$embind_global$$$"] == obj;
            if (!success) {
              delete obj["$$$embind_global$$$"];
            }
            return success;
          }
          if (typeof $$$embind_global$$$ == "object") {
            return $$$embind_global$$$;
          }
          if (typeof global == "object" && testGlobal(global)) {
            $$$embind_global$$$ = global;
          } else if (typeof self == "object" && testGlobal(self)) {
            $$$embind_global$$$ = self;
          }
          if (typeof $$$embind_global$$$ == "object") {
            return $$$embind_global$$$;
          }
          throw Error("unable to get global object.");
        }
        function __emval_get_global(name) {
          if (name === 0) {
            return Emval.toHandle(emval_get_global());
          } else {
            name = getStringOrSymbol(name);
            return Emval.toHandle(emval_get_global()[name]);
          }
        }
        function __emval_incref(handle) {
          if (handle > 4) {
            emval_handle_array[handle].refcount += 1;
          }
        }
        function craftEmvalAllocator(argCount) {
          var argsList = new Array(argCount + 1);
          return function(constructor, argTypes, args) {
            argsList[0] = constructor;
            for (var i = 0; i < argCount; ++i) {
              var argType = requireRegisteredType(HEAPU32[argTypes + i * 4 >> 2], "parameter " + i);
              argsList[i + 1] = argType["readValueFromPointer"](args);
              args += argType["argPackAdvance"];
            }
            var obj = new (constructor.bind.apply(constructor, argsList))();
            return Emval.toHandle(obj);
          };
        }
        var emval_newers = {};
        function __emval_new(handle, argCount, argTypes, args) {
          handle = Emval.toValue(handle);
          var newer = emval_newers[argCount];
          if (!newer) {
            newer = craftEmvalAllocator(argCount);
            emval_newers[argCount] = newer;
          }
          return newer(handle, argTypes, args);
        }
        function _abort() {
          abort("");
        }
        function _emscripten_memcpy_big(dest, src, num) {
          HEAPU8.copyWithin(dest, src, src + num);
        }
        function getHeapMax() {
          return 2147483648;
        }
        function emscripten_realloc_buffer(size) {
          var b = wasmMemory.buffer;
          try {
            wasmMemory.grow(size - b.byteLength + 65535 >>> 16);
            updateMemoryViews();
            return 1;
          } catch (e) {
          }
        }
        function _emscripten_resize_heap(requestedSize) {
          var oldSize = HEAPU8.length;
          requestedSize = requestedSize >>> 0;
          var maxHeapSize = getHeapMax();
          if (requestedSize > maxHeapSize) {
            return false;
          }
          let alignUp = (x, multiple) => x + (multiple - x % multiple) % multiple;
          for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
            var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
            overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
            var newSize = Math.min(maxHeapSize, alignUp(Math.max(requestedSize, overGrownHeapSize), 65536));
            var replacement = emscripten_realloc_buffer(newSize);
            if (replacement) {
              return true;
            }
          }
          return false;
        }
        InternalError = Module3["InternalError"] = extendError(Error, "InternalError");
        embind_init_charCodes();
        BindingError = Module3["BindingError"] = extendError(Error, "BindingError");
        init_emval();
        UnboundTypeError = Module3["UnboundTypeError"] = extendError(Error, "UnboundTypeError");
        var wasmImports = { "k": ___cxa_throw, "m": __embind_finalize_value_object, "o": __embind_register_bigint, "t": __embind_register_bool, "s": __embind_register_emval, "q": __embind_register_enum, "d": __embind_register_enum_value, "h": __embind_register_float, "f": __embind_register_function, "c": __embind_register_integer, "b": __embind_register_memory_view, "i": __embind_register_std_string, "e": __embind_register_std_wstring, "n": __embind_register_value_object, "a": __embind_register_value_object_field, "u": __embind_register_void, "j": __emval_decref, "w": __emval_get_global, "l": __emval_incref, "v": __emval_new, "g": _abort, "r": _emscripten_memcpy_big, "p": _emscripten_resize_heap };
        var asm = createWasm();
        var ___wasm_call_ctors = function() {
          return (___wasm_call_ctors = Module3["asm"]["y"]).apply(null, arguments);
        };
        var _malloc = function() {
          return (_malloc = Module3["asm"]["z"]).apply(null, arguments);
        };
        var _free = function() {
          return (_free = Module3["asm"]["A"]).apply(null, arguments);
        };
        var ___getTypeName = Module3["___getTypeName"] = function() {
          return (___getTypeName = Module3["___getTypeName"] = Module3["asm"]["B"]).apply(null, arguments);
        };
        var __embind_initialize_bindings = Module3["__embind_initialize_bindings"] = function() {
          return (__embind_initialize_bindings = Module3["__embind_initialize_bindings"] = Module3["asm"]["C"]).apply(null, arguments);
        };
        var ___errno_location = function() {
          return (___errno_location = Module3["asm"]["__errno_location"]).apply(null, arguments);
        };
        var ___cxa_is_pointer_type = function() {
          return (___cxa_is_pointer_type = Module3["asm"]["E"]).apply(null, arguments);
        };
        var dynCall_jiiii = Module3["dynCall_jiiii"] = function() {
          return (dynCall_jiiii = Module3["dynCall_jiiii"] = Module3["asm"]["F"]).apply(null, arguments);
        };
        var calledRun;
        dependenciesFulfilled = function runCaller() {
          if (!calledRun) run();
          if (!calledRun) dependenciesFulfilled = runCaller;
        };
        function run() {
          if (runDependencies > 0) {
            return;
          }
          preRun();
          if (runDependencies > 0) {
            return;
          }
          function doRun() {
            if (calledRun) return;
            calledRun = true;
            Module3["calledRun"] = true;
            if (ABORT) return;
            initRuntime();
            readyPromiseResolve(Module3);
            if (Module3["onRuntimeInitialized"]) Module3["onRuntimeInitialized"]();
            postRun();
          }
          if (Module3["setStatus"]) {
            Module3["setStatus"]("Running...");
            setTimeout(function() {
              setTimeout(function() {
                Module3["setStatus"]("");
              }, 1);
              doRun();
            }, 1);
          } else {
            doRun();
          }
        }
        if (Module3["preInit"]) {
          if (typeof Module3["preInit"] == "function") Module3["preInit"] = [Module3["preInit"]];
          while (Module3["preInit"].length > 0) {
            Module3["preInit"].pop()();
          }
        }
        run();
        return Module3.ready;
      });
    })();
    webp_enc_simd_default = Module;
  }
});

// ../admin/node_modules/.pnpm/@jsquash+webp@1.5.0/node_modules/@jsquash/webp/codec/enc/webp_enc.js
var webp_enc_exports = {};
__export(webp_enc_exports, {
  default: () => webp_enc_default
});
var Module2, webp_enc_default;
var init_webp_enc = __esm({
  "../admin/node_modules/.pnpm/@jsquash+webp@1.5.0/node_modules/@jsquash/webp/codec/enc/webp_enc.js"() {
    Module2 = (() => {
      var _scriptDir = import.meta.url;
      return (function(Module3 = {}) {
        var Module3 = typeof Module3 != "undefined" ? Module3 : {};
        var readyPromiseResolve, readyPromiseReject;
        Module3["ready"] = new Promise(function(resolve, reject) {
          readyPromiseResolve = resolve;
          readyPromiseReject = reject;
        });
        const isServiceWorker4 = globalThis.ServiceWorkerGlobalScope !== void 0;
        const isRunningInCloudFlareWorkers4 = isServiceWorker4 && typeof self !== "undefined" && globalThis.caches && globalThis.caches.default !== void 0;
        const isRunningInNode4 = typeof process === "object" && process.release && process.release.name === "node";
        if (isRunningInCloudFlareWorkers4 || isRunningInNode4) {
          if (!globalThis.ImageData) {
            globalThis.ImageData = class ImageData {
              constructor(data, width, height) {
                this.data = data;
                this.width = width;
                this.height = height;
              }
            };
          }
          if (import.meta.url === void 0) {
            import.meta.url = "https://localhost";
          }
          if (typeof self !== "undefined" && self.location === void 0) {
            self.location = { href: "" };
          }
        }
        var moduleOverrides = Object.assign({}, Module3);
        var arguments_ = [];
        var thisProgram = "./this.program";
        var quit_ = (status, toThrow) => {
          throw toThrow;
        };
        var ENVIRONMENT_IS_WEB = typeof window == "object";
        var ENVIRONMENT_IS_WORKER = typeof importScripts == "function";
        var ENVIRONMENT_IS_NODE = typeof process == "object" && typeof process.versions == "object" && typeof process.versions.node == "string";
        var scriptDirectory = "";
        function locateFile(path) {
          if (Module3["locateFile"]) {
            return Module3["locateFile"](path, scriptDirectory);
          }
          return scriptDirectory + path;
        }
        var read_, readAsync, readBinary, setWindowTitle;
        if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
          if (ENVIRONMENT_IS_WORKER) {
            scriptDirectory = self.location.href;
          } else if (typeof document != "undefined" && document.currentScript) {
            scriptDirectory = document.currentScript.src;
          }
          if (_scriptDir) {
            scriptDirectory = _scriptDir;
          }
          if (scriptDirectory.indexOf("blob:") !== 0) {
            scriptDirectory = scriptDirectory.substr(0, scriptDirectory.replace(/[?#].*/, "").lastIndexOf("/") + 1);
          } else {
            scriptDirectory = "";
          }
          {
            read_ = (url) => {
              var xhr = new XMLHttpRequest();
              xhr.open("GET", url, false);
              xhr.send(null);
              return xhr.responseText;
            };
            if (ENVIRONMENT_IS_WORKER) {
              readBinary = (url) => {
                var xhr = new XMLHttpRequest();
                xhr.open("GET", url, false);
                xhr.responseType = "arraybuffer";
                xhr.send(null);
                return new Uint8Array(xhr.response);
              };
            }
            readAsync = (url, onload, onerror) => {
              var xhr = new XMLHttpRequest();
              xhr.open("GET", url, true);
              xhr.responseType = "arraybuffer";
              xhr.onload = () => {
                if (xhr.status == 200 || xhr.status == 0 && xhr.response) {
                  onload(xhr.response);
                  return;
                }
                onerror();
              };
              xhr.onerror = onerror;
              xhr.send(null);
            };
          }
          setWindowTitle = (title) => document.title = title;
        } else {
        }
        var out = Module3["print"] || console.log.bind(console);
        var err = Module3["printErr"] || console.warn.bind(console);
        Object.assign(Module3, moduleOverrides);
        moduleOverrides = null;
        if (Module3["arguments"]) arguments_ = Module3["arguments"];
        if (Module3["thisProgram"]) thisProgram = Module3["thisProgram"];
        if (Module3["quit"]) quit_ = Module3["quit"];
        var wasmBinary;
        if (Module3["wasmBinary"]) wasmBinary = Module3["wasmBinary"];
        var noExitRuntime = Module3["noExitRuntime"] || true;
        if (typeof WebAssembly != "object") {
          abort("no native wasm support detected");
        }
        var wasmMemory;
        var ABORT = false;
        var EXITSTATUS;
        function UTF8ArrayToString(heapOrArray, idx, maxBytesToRead) {
          var endIdx = idx + maxBytesToRead;
          var str = "";
          while (!(idx >= endIdx)) {
            var u0 = heapOrArray[idx++];
            if (!u0) return str;
            if (!(u0 & 128)) {
              str += String.fromCharCode(u0);
              continue;
            }
            var u1 = heapOrArray[idx++] & 63;
            if ((u0 & 224) == 192) {
              str += String.fromCharCode((u0 & 31) << 6 | u1);
              continue;
            }
            var u2 = heapOrArray[idx++] & 63;
            if ((u0 & 240) == 224) {
              u0 = (u0 & 15) << 12 | u1 << 6 | u2;
            } else {
              u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | heapOrArray[idx++] & 63;
            }
            if (u0 < 65536) {
              str += String.fromCharCode(u0);
            } else {
              var ch = u0 - 65536;
              str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
            }
          }
          return str;
        }
        function UTF8ToString(ptr, maxBytesToRead) {
          return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : "";
        }
        function stringToUTF8Array(str, heap, outIdx, maxBytesToWrite) {
          if (!(maxBytesToWrite > 0)) return 0;
          var startIdx = outIdx;
          var endIdx = outIdx + maxBytesToWrite - 1;
          for (var i = 0; i < str.length; ++i) {
            var u = str.charCodeAt(i);
            if (u >= 55296 && u <= 57343) {
              var u1 = str.charCodeAt(++i);
              u = 65536 + ((u & 1023) << 10) | u1 & 1023;
            }
            if (u <= 127) {
              if (outIdx >= endIdx) break;
              heap[outIdx++] = u;
            } else if (u <= 2047) {
              if (outIdx + 1 >= endIdx) break;
              heap[outIdx++] = 192 | u >> 6;
              heap[outIdx++] = 128 | u & 63;
            } else if (u <= 65535) {
              if (outIdx + 2 >= endIdx) break;
              heap[outIdx++] = 224 | u >> 12;
              heap[outIdx++] = 128 | u >> 6 & 63;
              heap[outIdx++] = 128 | u & 63;
            } else {
              if (outIdx + 3 >= endIdx) break;
              heap[outIdx++] = 240 | u >> 18;
              heap[outIdx++] = 128 | u >> 12 & 63;
              heap[outIdx++] = 128 | u >> 6 & 63;
              heap[outIdx++] = 128 | u & 63;
            }
          }
          heap[outIdx] = 0;
          return outIdx - startIdx;
        }
        function stringToUTF8(str, outPtr, maxBytesToWrite) {
          return stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
        }
        function lengthBytesUTF8(str) {
          var len = 0;
          for (var i = 0; i < str.length; ++i) {
            var c = str.charCodeAt(i);
            if (c <= 127) {
              len++;
            } else if (c <= 2047) {
              len += 2;
            } else if (c >= 55296 && c <= 57343) {
              len += 4;
              ++i;
            } else {
              len += 3;
            }
          }
          return len;
        }
        var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;
        function updateMemoryViews() {
          var b = wasmMemory.buffer;
          Module3["HEAP8"] = HEAP8 = new Int8Array(b);
          Module3["HEAP16"] = HEAP16 = new Int16Array(b);
          Module3["HEAP32"] = HEAP32 = new Int32Array(b);
          Module3["HEAPU8"] = HEAPU8 = new Uint8Array(b);
          Module3["HEAPU16"] = HEAPU16 = new Uint16Array(b);
          Module3["HEAPU32"] = HEAPU32 = new Uint32Array(b);
          Module3["HEAPF32"] = HEAPF32 = new Float32Array(b);
          Module3["HEAPF64"] = HEAPF64 = new Float64Array(b);
        }
        var wasmTable;
        var __ATPRERUN__ = [];
        var __ATINIT__ = [];
        var __ATPOSTRUN__ = [];
        var runtimeInitialized = false;
        function preRun() {
          if (Module3["preRun"]) {
            if (typeof Module3["preRun"] == "function") Module3["preRun"] = [Module3["preRun"]];
            while (Module3["preRun"].length) {
              addOnPreRun(Module3["preRun"].shift());
            }
          }
          callRuntimeCallbacks(__ATPRERUN__);
        }
        function initRuntime() {
          runtimeInitialized = true;
          callRuntimeCallbacks(__ATINIT__);
        }
        function postRun() {
          if (Module3["postRun"]) {
            if (typeof Module3["postRun"] == "function") Module3["postRun"] = [Module3["postRun"]];
            while (Module3["postRun"].length) {
              addOnPostRun(Module3["postRun"].shift());
            }
          }
          callRuntimeCallbacks(__ATPOSTRUN__);
        }
        function addOnPreRun(cb) {
          __ATPRERUN__.unshift(cb);
        }
        function addOnInit(cb) {
          __ATINIT__.unshift(cb);
        }
        function addOnPostRun(cb) {
          __ATPOSTRUN__.unshift(cb);
        }
        var runDependencies = 0;
        var runDependencyWatcher = null;
        var dependenciesFulfilled = null;
        function addRunDependency(id) {
          runDependencies++;
          if (Module3["monitorRunDependencies"]) {
            Module3["monitorRunDependencies"](runDependencies);
          }
        }
        function removeRunDependency(id) {
          runDependencies--;
          if (Module3["monitorRunDependencies"]) {
            Module3["monitorRunDependencies"](runDependencies);
          }
          if (runDependencies == 0) {
            if (runDependencyWatcher !== null) {
              clearInterval(runDependencyWatcher);
              runDependencyWatcher = null;
            }
            if (dependenciesFulfilled) {
              var callback = dependenciesFulfilled;
              dependenciesFulfilled = null;
              callback();
            }
          }
        }
        function abort(what) {
          if (Module3["onAbort"]) {
            Module3["onAbort"](what);
          }
          what = "Aborted(" + what + ")";
          err(what);
          ABORT = true;
          EXITSTATUS = 1;
          what += ". Build with -sASSERTIONS for more info.";
          var e = new WebAssembly.RuntimeError(what);
          readyPromiseReject(e);
          throw e;
        }
        var dataURIPrefix = "data:application/octet-stream;base64,";
        function isDataURI(filename) {
          return filename.startsWith(dataURIPrefix);
        }
        var wasmBinaryFile;
        if (Module3["locateFile"]) {
          wasmBinaryFile = "webp_enc.wasm";
          if (!isDataURI(wasmBinaryFile)) {
            wasmBinaryFile = locateFile(wasmBinaryFile);
          }
        } else {
          wasmBinaryFile = new URL("webp_enc.wasm", import.meta.url).href;
        }
        function getBinary(file) {
          try {
            if (file == wasmBinaryFile && wasmBinary) {
              return new Uint8Array(wasmBinary);
            }
            if (readBinary) {
              return readBinary(file);
            }
            throw "both async and sync fetching of the wasm failed";
          } catch (err2) {
            abort(err2);
          }
        }
        function getBinaryPromise(binaryFile) {
          if (!wasmBinary && (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER)) {
            if (typeof fetch == "function") {
              return fetch(binaryFile, { credentials: "same-origin" }).then(function(response) {
                if (!response["ok"]) {
                  throw "failed to load wasm binary file at '" + binaryFile + "'";
                }
                return response["arrayBuffer"]();
              }).catch(function() {
                return getBinary(binaryFile);
              });
            }
          }
          return Promise.resolve().then(function() {
            return getBinary(binaryFile);
          });
        }
        function instantiateArrayBuffer(binaryFile, imports, receiver) {
          return getBinaryPromise(binaryFile).then(function(binary) {
            return WebAssembly.instantiate(binary, imports);
          }).then(function(instance) {
            return instance;
          }).then(receiver, function(reason) {
            err("failed to asynchronously prepare wasm: " + reason);
            abort(reason);
          });
        }
        function instantiateAsync(binary, binaryFile, imports, callback) {
          if (!binary && typeof WebAssembly.instantiateStreaming == "function" && !isDataURI(binaryFile) && typeof fetch == "function") {
            return fetch(binaryFile, { credentials: "same-origin" }).then(function(response) {
              var result = WebAssembly.instantiateStreaming(response, imports);
              return result.then(callback, function(reason) {
                err("wasm streaming compile failed: " + reason);
                err("falling back to ArrayBuffer instantiation");
                return instantiateArrayBuffer(binaryFile, imports, callback);
              });
            });
          } else {
            return instantiateArrayBuffer(binaryFile, imports, callback);
          }
        }
        function createWasm() {
          var info = { "a": wasmImports };
          function receiveInstance(instance, module) {
            var exports = instance.exports;
            Module3["asm"] = exports;
            wasmMemory = Module3["asm"]["x"];
            updateMemoryViews();
            wasmTable = Module3["asm"]["D"];
            addOnInit(Module3["asm"]["y"]);
            removeRunDependency("wasm-instantiate");
            return exports;
          }
          addRunDependency("wasm-instantiate");
          function receiveInstantiationResult(result) {
            receiveInstance(result["instance"]);
          }
          if (Module3["instantiateWasm"]) {
            try {
              return Module3["instantiateWasm"](info, receiveInstance);
            } catch (e) {
              err("Module.instantiateWasm callback failed with error: " + e);
              readyPromiseReject(e);
            }
          }
          instantiateAsync(wasmBinary, wasmBinaryFile, info, receiveInstantiationResult).catch(readyPromiseReject);
          return {};
        }
        function callRuntimeCallbacks(callbacks) {
          while (callbacks.length > 0) {
            callbacks.shift()(Module3);
          }
        }
        function ExceptionInfo(excPtr) {
          this.excPtr = excPtr;
          this.ptr = excPtr - 24;
          this.set_type = function(type) {
            HEAPU32[this.ptr + 4 >> 2] = type;
          };
          this.get_type = function() {
            return HEAPU32[this.ptr + 4 >> 2];
          };
          this.set_destructor = function(destructor) {
            HEAPU32[this.ptr + 8 >> 2] = destructor;
          };
          this.get_destructor = function() {
            return HEAPU32[this.ptr + 8 >> 2];
          };
          this.set_refcount = function(refcount) {
            HEAP32[this.ptr >> 2] = refcount;
          };
          this.set_caught = function(caught) {
            caught = caught ? 1 : 0;
            HEAP8[this.ptr + 12 >> 0] = caught;
          };
          this.get_caught = function() {
            return HEAP8[this.ptr + 12 >> 0] != 0;
          };
          this.set_rethrown = function(rethrown) {
            rethrown = rethrown ? 1 : 0;
            HEAP8[this.ptr + 13 >> 0] = rethrown;
          };
          this.get_rethrown = function() {
            return HEAP8[this.ptr + 13 >> 0] != 0;
          };
          this.init = function(type, destructor) {
            this.set_adjusted_ptr(0);
            this.set_type(type);
            this.set_destructor(destructor);
            this.set_refcount(0);
            this.set_caught(false);
            this.set_rethrown(false);
          };
          this.add_ref = function() {
            var value = HEAP32[this.ptr >> 2];
            HEAP32[this.ptr >> 2] = value + 1;
          };
          this.release_ref = function() {
            var prev = HEAP32[this.ptr >> 2];
            HEAP32[this.ptr >> 2] = prev - 1;
            return prev === 1;
          };
          this.set_adjusted_ptr = function(adjustedPtr) {
            HEAPU32[this.ptr + 16 >> 2] = adjustedPtr;
          };
          this.get_adjusted_ptr = function() {
            return HEAPU32[this.ptr + 16 >> 2];
          };
          this.get_exception_ptr = function() {
            var isPointer = ___cxa_is_pointer_type(this.get_type());
            if (isPointer) {
              return HEAPU32[this.excPtr >> 2];
            }
            var adjusted = this.get_adjusted_ptr();
            if (adjusted !== 0) return adjusted;
            return this.excPtr;
          };
        }
        var exceptionLast = 0;
        var uncaughtExceptionCount = 0;
        function ___cxa_throw(ptr, type, destructor) {
          var info = new ExceptionInfo(ptr);
          info.init(type, destructor);
          exceptionLast = ptr;
          uncaughtExceptionCount++;
          throw ptr;
        }
        var structRegistrations = {};
        function runDestructors(destructors) {
          while (destructors.length) {
            var ptr = destructors.pop();
            var del = destructors.pop();
            del(ptr);
          }
        }
        function simpleReadValueFromPointer(pointer) {
          return this["fromWireType"](HEAP32[pointer >> 2]);
        }
        var awaitingDependencies = {};
        var registeredTypes = {};
        var typeDependencies = {};
        var char_0 = 48;
        var char_9 = 57;
        function makeLegalFunctionName(name) {
          if (void 0 === name) {
            return "_unknown";
          }
          name = name.replace(/[^a-zA-Z0-9_]/g, "$");
          var f = name.charCodeAt(0);
          if (f >= char_0 && f <= char_9) {
            return "_" + name;
          }
          return name;
        }
        function createNamedFunction(name, body) {
          name = makeLegalFunctionName(name);
          return { [name]: function() {
            return body.apply(this, arguments);
          } }[name];
        }
        function extendError(baseErrorType, errorName) {
          var errorClass = createNamedFunction(errorName, function(message) {
            this.name = errorName;
            this.message = message;
            var stack = new Error(message).stack;
            if (stack !== void 0) {
              this.stack = this.toString() + "\n" + stack.replace(/^Error(:[^\n]*)?\n/, "");
            }
          });
          errorClass.prototype = Object.create(baseErrorType.prototype);
          errorClass.prototype.constructor = errorClass;
          errorClass.prototype.toString = function() {
            if (this.message === void 0) {
              return this.name;
            } else {
              return this.name + ": " + this.message;
            }
          };
          return errorClass;
        }
        var InternalError = void 0;
        function throwInternalError(message) {
          throw new InternalError(message);
        }
        function whenDependentTypesAreResolved(myTypes, dependentTypes, getTypeConverters) {
          myTypes.forEach(function(type) {
            typeDependencies[type] = dependentTypes;
          });
          function onComplete(typeConverters2) {
            var myTypeConverters = getTypeConverters(typeConverters2);
            if (myTypeConverters.length !== myTypes.length) {
              throwInternalError("Mismatched type converter count");
            }
            for (var i = 0; i < myTypes.length; ++i) {
              registerType(myTypes[i], myTypeConverters[i]);
            }
          }
          var typeConverters = new Array(dependentTypes.length);
          var unregisteredTypes = [];
          var registered = 0;
          dependentTypes.forEach((dt, i) => {
            if (registeredTypes.hasOwnProperty(dt)) {
              typeConverters[i] = registeredTypes[dt];
            } else {
              unregisteredTypes.push(dt);
              if (!awaitingDependencies.hasOwnProperty(dt)) {
                awaitingDependencies[dt] = [];
              }
              awaitingDependencies[dt].push(() => {
                typeConverters[i] = registeredTypes[dt];
                ++registered;
                if (registered === unregisteredTypes.length) {
                  onComplete(typeConverters);
                }
              });
            }
          });
          if (0 === unregisteredTypes.length) {
            onComplete(typeConverters);
          }
        }
        function __embind_finalize_value_object(structType) {
          var reg = structRegistrations[structType];
          delete structRegistrations[structType];
          var rawConstructor = reg.rawConstructor;
          var rawDestructor = reg.rawDestructor;
          var fieldRecords = reg.fields;
          var fieldTypes = fieldRecords.map((field) => field.getterReturnType).concat(fieldRecords.map((field) => field.setterArgumentType));
          whenDependentTypesAreResolved([structType], fieldTypes, (fieldTypes2) => {
            var fields = {};
            fieldRecords.forEach((field, i) => {
              var fieldName = field.fieldName;
              var getterReturnType = fieldTypes2[i];
              var getter = field.getter;
              var getterContext = field.getterContext;
              var setterArgumentType = fieldTypes2[i + fieldRecords.length];
              var setter = field.setter;
              var setterContext = field.setterContext;
              fields[fieldName] = { read: (ptr) => {
                return getterReturnType["fromWireType"](getter(getterContext, ptr));
              }, write: (ptr, o) => {
                var destructors = [];
                setter(setterContext, ptr, setterArgumentType["toWireType"](destructors, o));
                runDestructors(destructors);
              } };
            });
            return [{ name: reg.name, "fromWireType": function(ptr) {
              var rv = {};
              for (var i in fields) {
                rv[i] = fields[i].read(ptr);
              }
              rawDestructor(ptr);
              return rv;
            }, "toWireType": function(destructors, o) {
              for (var fieldName in fields) {
                if (!(fieldName in o)) {
                  throw new TypeError('Missing field:  "' + fieldName + '"');
                }
              }
              var ptr = rawConstructor();
              for (fieldName in fields) {
                fields[fieldName].write(ptr, o[fieldName]);
              }
              if (destructors !== null) {
                destructors.push(rawDestructor, ptr);
              }
              return ptr;
            }, "argPackAdvance": 8, "readValueFromPointer": simpleReadValueFromPointer, destructorFunction: rawDestructor }];
          });
        }
        function __embind_register_bigint(primitiveType, name, size, minRange, maxRange) {
        }
        function getShiftFromSize(size) {
          switch (size) {
            case 1:
              return 0;
            case 2:
              return 1;
            case 4:
              return 2;
            case 8:
              return 3;
            default:
              throw new TypeError("Unknown type size: " + size);
          }
        }
        function embind_init_charCodes() {
          var codes = new Array(256);
          for (var i = 0; i < 256; ++i) {
            codes[i] = String.fromCharCode(i);
          }
          embind_charCodes = codes;
        }
        var embind_charCodes = void 0;
        function readLatin1String(ptr) {
          var ret = "";
          var c = ptr;
          while (HEAPU8[c]) {
            ret += embind_charCodes[HEAPU8[c++]];
          }
          return ret;
        }
        var BindingError = void 0;
        function throwBindingError(message) {
          throw new BindingError(message);
        }
        function registerType(rawType, registeredInstance, options = {}) {
          if (!("argPackAdvance" in registeredInstance)) {
            throw new TypeError("registerType registeredInstance requires argPackAdvance");
          }
          var name = registeredInstance.name;
          if (!rawType) {
            throwBindingError('type "' + name + '" must have a positive integer typeid pointer');
          }
          if (registeredTypes.hasOwnProperty(rawType)) {
            if (options.ignoreDuplicateRegistrations) {
              return;
            } else {
              throwBindingError("Cannot register type '" + name + "' twice");
            }
          }
          registeredTypes[rawType] = registeredInstance;
          delete typeDependencies[rawType];
          if (awaitingDependencies.hasOwnProperty(rawType)) {
            var callbacks = awaitingDependencies[rawType];
            delete awaitingDependencies[rawType];
            callbacks.forEach((cb) => cb());
          }
        }
        function __embind_register_bool(rawType, name, size, trueValue, falseValue) {
          var shift = getShiftFromSize(size);
          name = readLatin1String(name);
          registerType(rawType, { name, "fromWireType": function(wt) {
            return !!wt;
          }, "toWireType": function(destructors, o) {
            return o ? trueValue : falseValue;
          }, "argPackAdvance": 8, "readValueFromPointer": function(pointer) {
            var heap;
            if (size === 1) {
              heap = HEAP8;
            } else if (size === 2) {
              heap = HEAP16;
            } else if (size === 4) {
              heap = HEAP32;
            } else {
              throw new TypeError("Unknown boolean type size: " + name);
            }
            return this["fromWireType"](heap[pointer >> shift]);
          }, destructorFunction: null });
        }
        var emval_free_list = [];
        var emval_handle_array = [{}, { value: void 0 }, { value: null }, { value: true }, { value: false }];
        function __emval_decref(handle) {
          if (handle > 4 && 0 === --emval_handle_array[handle].refcount) {
            emval_handle_array[handle] = void 0;
            emval_free_list.push(handle);
          }
        }
        function count_emval_handles() {
          var count = 0;
          for (var i = 5; i < emval_handle_array.length; ++i) {
            if (emval_handle_array[i] !== void 0) {
              ++count;
            }
          }
          return count;
        }
        function get_first_emval() {
          for (var i = 5; i < emval_handle_array.length; ++i) {
            if (emval_handle_array[i] !== void 0) {
              return emval_handle_array[i];
            }
          }
          return null;
        }
        function init_emval() {
          Module3["count_emval_handles"] = count_emval_handles;
          Module3["get_first_emval"] = get_first_emval;
        }
        var Emval = { toValue: (handle) => {
          if (!handle) {
            throwBindingError("Cannot use deleted val. handle = " + handle);
          }
          return emval_handle_array[handle].value;
        }, toHandle: (value) => {
          switch (value) {
            case void 0:
              return 1;
            case null:
              return 2;
            case true:
              return 3;
            case false:
              return 4;
            default: {
              var handle = emval_free_list.length ? emval_free_list.pop() : emval_handle_array.length;
              emval_handle_array[handle] = { refcount: 1, value };
              return handle;
            }
          }
        } };
        function __embind_register_emval(rawType, name) {
          name = readLatin1String(name);
          registerType(rawType, { name, "fromWireType": function(handle) {
            var rv = Emval.toValue(handle);
            __emval_decref(handle);
            return rv;
          }, "toWireType": function(destructors, value) {
            return Emval.toHandle(value);
          }, "argPackAdvance": 8, "readValueFromPointer": simpleReadValueFromPointer, destructorFunction: null });
        }
        function ensureOverloadTable(proto, methodName, humanName) {
          if (void 0 === proto[methodName].overloadTable) {
            var prevFunc = proto[methodName];
            proto[methodName] = function() {
              if (!proto[methodName].overloadTable.hasOwnProperty(arguments.length)) {
                throwBindingError("Function '" + humanName + "' called with an invalid number of arguments (" + arguments.length + ") - expects one of (" + proto[methodName].overloadTable + ")!");
              }
              return proto[methodName].overloadTable[arguments.length].apply(this, arguments);
            };
            proto[methodName].overloadTable = [];
            proto[methodName].overloadTable[prevFunc.argCount] = prevFunc;
          }
        }
        function exposePublicSymbol(name, value, numArguments) {
          if (Module3.hasOwnProperty(name)) {
            if (void 0 === numArguments || void 0 !== Module3[name].overloadTable && void 0 !== Module3[name].overloadTable[numArguments]) {
              throwBindingError("Cannot register public name '" + name + "' twice");
            }
            ensureOverloadTable(Module3, name, name);
            if (Module3.hasOwnProperty(numArguments)) {
              throwBindingError("Cannot register multiple overloads of a function with the same number of arguments (" + numArguments + ")!");
            }
            Module3[name].overloadTable[numArguments] = value;
          } else {
            Module3[name] = value;
            if (void 0 !== numArguments) {
              Module3[name].numArguments = numArguments;
            }
          }
        }
        function enumReadValueFromPointer(name, shift, signed) {
          switch (shift) {
            case 0:
              return function(pointer) {
                var heap = signed ? HEAP8 : HEAPU8;
                return this["fromWireType"](heap[pointer]);
              };
            case 1:
              return function(pointer) {
                var heap = signed ? HEAP16 : HEAPU16;
                return this["fromWireType"](heap[pointer >> 1]);
              };
            case 2:
              return function(pointer) {
                var heap = signed ? HEAP32 : HEAPU32;
                return this["fromWireType"](heap[pointer >> 2]);
              };
            default:
              throw new TypeError("Unknown integer type: " + name);
          }
        }
        function __embind_register_enum(rawType, name, size, isSigned) {
          var shift = getShiftFromSize(size);
          name = readLatin1String(name);
          function ctor() {
          }
          ctor.values = {};
          registerType(rawType, { name, constructor: ctor, "fromWireType": function(c) {
            return this.constructor.values[c];
          }, "toWireType": function(destructors, c) {
            return c.value;
          }, "argPackAdvance": 8, "readValueFromPointer": enumReadValueFromPointer(name, shift, isSigned), destructorFunction: null });
          exposePublicSymbol(name, ctor);
        }
        function getTypeName(type) {
          var ptr = ___getTypeName(type);
          var rv = readLatin1String(ptr);
          _free(ptr);
          return rv;
        }
        function requireRegisteredType(rawType, humanName) {
          var impl = registeredTypes[rawType];
          if (void 0 === impl) {
            throwBindingError(humanName + " has unknown type " + getTypeName(rawType));
          }
          return impl;
        }
        function __embind_register_enum_value(rawEnumType, name, enumValue) {
          var enumType = requireRegisteredType(rawEnumType, "enum");
          name = readLatin1String(name);
          var Enum = enumType.constructor;
          var Value = Object.create(enumType.constructor.prototype, { value: { value: enumValue }, constructor: { value: createNamedFunction(enumType.name + "_" + name, function() {
          }) } });
          Enum.values[enumValue] = Value;
          Enum[name] = Value;
        }
        function floatReadValueFromPointer(name, shift) {
          switch (shift) {
            case 2:
              return function(pointer) {
                return this["fromWireType"](HEAPF32[pointer >> 2]);
              };
            case 3:
              return function(pointer) {
                return this["fromWireType"](HEAPF64[pointer >> 3]);
              };
            default:
              throw new TypeError("Unknown float type: " + name);
          }
        }
        function __embind_register_float(rawType, name, size) {
          var shift = getShiftFromSize(size);
          name = readLatin1String(name);
          registerType(rawType, { name, "fromWireType": function(value) {
            return value;
          }, "toWireType": function(destructors, value) {
            return value;
          }, "argPackAdvance": 8, "readValueFromPointer": floatReadValueFromPointer(name, shift), destructorFunction: null });
        }
        function craftInvokerFunction(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc, isAsync) {
          var argCount = argTypes.length;
          if (argCount < 2) {
            throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!");
          }
          var isClassMethodFunc = argTypes[1] !== null && classType !== null;
          var needsDestructorStack = false;
          for (var i = 1; i < argTypes.length; ++i) {
            if (argTypes[i] !== null && argTypes[i].destructorFunction === void 0) {
              needsDestructorStack = true;
              break;
            }
          }
          var returns = argTypes[0].name !== "void";
          var expectedArgCount = argCount - 2;
          var argsWired = new Array(expectedArgCount);
          var invokerFuncArgs = [];
          var destructors = [];
          return function() {
            if (arguments.length !== expectedArgCount) {
              throwBindingError("function " + humanName + " called with " + arguments.length + " arguments, expected " + expectedArgCount + " args!");
            }
            destructors.length = 0;
            var thisWired;
            invokerFuncArgs.length = isClassMethodFunc ? 2 : 1;
            invokerFuncArgs[0] = cppTargetFunc;
            if (isClassMethodFunc) {
              thisWired = argTypes[1]["toWireType"](destructors, this);
              invokerFuncArgs[1] = thisWired;
            }
            for (var i2 = 0; i2 < expectedArgCount; ++i2) {
              argsWired[i2] = argTypes[i2 + 2]["toWireType"](destructors, arguments[i2]);
              invokerFuncArgs.push(argsWired[i2]);
            }
            var rv = cppInvokerFunc.apply(null, invokerFuncArgs);
            function onDone(rv2) {
              if (needsDestructorStack) {
                runDestructors(destructors);
              } else {
                for (var i3 = isClassMethodFunc ? 1 : 2; i3 < argTypes.length; i3++) {
                  var param = i3 === 1 ? thisWired : argsWired[i3 - 2];
                  if (argTypes[i3].destructorFunction !== null) {
                    argTypes[i3].destructorFunction(param);
                  }
                }
              }
              if (returns) {
                return argTypes[0]["fromWireType"](rv2);
              }
            }
            return onDone(rv);
          };
        }
        function heap32VectorToArray(count, firstElement) {
          var array = [];
          for (var i = 0; i < count; i++) {
            array.push(HEAPU32[firstElement + i * 4 >> 2]);
          }
          return array;
        }
        function replacePublicSymbol(name, value, numArguments) {
          if (!Module3.hasOwnProperty(name)) {
            throwInternalError("Replacing nonexistant public symbol");
          }
          if (void 0 !== Module3[name].overloadTable && void 0 !== numArguments) {
            Module3[name].overloadTable[numArguments] = value;
          } else {
            Module3[name] = value;
            Module3[name].argCount = numArguments;
          }
        }
        function dynCallLegacy(sig, ptr, args) {
          var f = Module3["dynCall_" + sig];
          return args && args.length ? f.apply(null, [ptr].concat(args)) : f.call(null, ptr);
        }
        var wasmTableMirror = [];
        function getWasmTableEntry(funcPtr) {
          var func = wasmTableMirror[funcPtr];
          if (!func) {
            if (funcPtr >= wasmTableMirror.length) wasmTableMirror.length = funcPtr + 1;
            wasmTableMirror[funcPtr] = func = wasmTable.get(funcPtr);
          }
          return func;
        }
        function dynCall(sig, ptr, args) {
          if (sig.includes("j")) {
            return dynCallLegacy(sig, ptr, args);
          }
          var rtn = getWasmTableEntry(ptr).apply(null, args);
          return rtn;
        }
        function getDynCaller(sig, ptr) {
          var argCache = [];
          return function() {
            argCache.length = 0;
            Object.assign(argCache, arguments);
            return dynCall(sig, ptr, argCache);
          };
        }
        function embind__requireFunction(signature, rawFunction) {
          signature = readLatin1String(signature);
          function makeDynCaller() {
            if (signature.includes("j")) {
              return getDynCaller(signature, rawFunction);
            }
            return getWasmTableEntry(rawFunction);
          }
          var fp = makeDynCaller();
          if (typeof fp != "function") {
            throwBindingError("unknown function pointer with signature " + signature + ": " + rawFunction);
          }
          return fp;
        }
        var UnboundTypeError = void 0;
        function throwUnboundTypeError(message, types) {
          var unboundTypes = [];
          var seen = {};
          function visit(type) {
            if (seen[type]) {
              return;
            }
            if (registeredTypes[type]) {
              return;
            }
            if (typeDependencies[type]) {
              typeDependencies[type].forEach(visit);
              return;
            }
            unboundTypes.push(type);
            seen[type] = true;
          }
          types.forEach(visit);
          throw new UnboundTypeError(message + ": " + unboundTypes.map(getTypeName).join([", "]));
        }
        function __embind_register_function(name, argCount, rawArgTypesAddr, signature, rawInvoker, fn, isAsync) {
          var argTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
          name = readLatin1String(name);
          rawInvoker = embind__requireFunction(signature, rawInvoker);
          exposePublicSymbol(name, function() {
            throwUnboundTypeError("Cannot call " + name + " due to unbound types", argTypes);
          }, argCount - 1);
          whenDependentTypesAreResolved([], argTypes, function(argTypes2) {
            var invokerArgsArray = [argTypes2[0], null].concat(argTypes2.slice(1));
            replacePublicSymbol(name, craftInvokerFunction(name, invokerArgsArray, null, rawInvoker, fn, isAsync), argCount - 1);
            return [];
          });
        }
        function integerReadValueFromPointer(name, shift, signed) {
          switch (shift) {
            case 0:
              return signed ? function readS8FromPointer(pointer) {
                return HEAP8[pointer];
              } : function readU8FromPointer(pointer) {
                return HEAPU8[pointer];
              };
            case 1:
              return signed ? function readS16FromPointer(pointer) {
                return HEAP16[pointer >> 1];
              } : function readU16FromPointer(pointer) {
                return HEAPU16[pointer >> 1];
              };
            case 2:
              return signed ? function readS32FromPointer(pointer) {
                return HEAP32[pointer >> 2];
              } : function readU32FromPointer(pointer) {
                return HEAPU32[pointer >> 2];
              };
            default:
              throw new TypeError("Unknown integer type: " + name);
          }
        }
        function __embind_register_integer(primitiveType, name, size, minRange, maxRange) {
          name = readLatin1String(name);
          if (maxRange === -1) {
            maxRange = 4294967295;
          }
          var shift = getShiftFromSize(size);
          var fromWireType = (value) => value;
          if (minRange === 0) {
            var bitshift = 32 - 8 * size;
            fromWireType = (value) => value << bitshift >>> bitshift;
          }
          var isUnsignedType = name.includes("unsigned");
          var checkAssertions = (value, toTypeName) => {
          };
          var toWireType;
          if (isUnsignedType) {
            toWireType = function(destructors, value) {
              checkAssertions(value, this.name);
              return value >>> 0;
            };
          } else {
            toWireType = function(destructors, value) {
              checkAssertions(value, this.name);
              return value;
            };
          }
          registerType(primitiveType, { name, "fromWireType": fromWireType, "toWireType": toWireType, "argPackAdvance": 8, "readValueFromPointer": integerReadValueFromPointer(name, shift, minRange !== 0), destructorFunction: null });
        }
        function __embind_register_memory_view(rawType, dataTypeIndex, name) {
          var typeMapping = [Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array];
          var TA = typeMapping[dataTypeIndex];
          function decodeMemoryView(handle) {
            handle = handle >> 2;
            var heap = HEAPU32;
            var size = heap[handle];
            var data = heap[handle + 1];
            return new TA(heap.buffer, data, size);
          }
          name = readLatin1String(name);
          registerType(rawType, { name, "fromWireType": decodeMemoryView, "argPackAdvance": 8, "readValueFromPointer": decodeMemoryView }, { ignoreDuplicateRegistrations: true });
        }
        function __embind_register_std_string(rawType, name) {
          name = readLatin1String(name);
          var stdStringIsUTF8 = name === "std::string";
          registerType(rawType, { name, "fromWireType": function(value) {
            var length = HEAPU32[value >> 2];
            var payload = value + 4;
            var str;
            if (stdStringIsUTF8) {
              var decodeStartPtr = payload;
              for (var i = 0; i <= length; ++i) {
                var currentBytePtr = payload + i;
                if (i == length || HEAPU8[currentBytePtr] == 0) {
                  var maxRead = currentBytePtr - decodeStartPtr;
                  var stringSegment = UTF8ToString(decodeStartPtr, maxRead);
                  if (str === void 0) {
                    str = stringSegment;
                  } else {
                    str += String.fromCharCode(0);
                    str += stringSegment;
                  }
                  decodeStartPtr = currentBytePtr + 1;
                }
              }
            } else {
              var a = new Array(length);
              for (var i = 0; i < length; ++i) {
                a[i] = String.fromCharCode(HEAPU8[payload + i]);
              }
              str = a.join("");
            }
            _free(value);
            return str;
          }, "toWireType": function(destructors, value) {
            if (value instanceof ArrayBuffer) {
              value = new Uint8Array(value);
            }
            var length;
            var valueIsOfTypeString = typeof value == "string";
            if (!(valueIsOfTypeString || value instanceof Uint8Array || value instanceof Uint8ClampedArray || value instanceof Int8Array)) {
              throwBindingError("Cannot pass non-string to std::string");
            }
            if (stdStringIsUTF8 && valueIsOfTypeString) {
              length = lengthBytesUTF8(value);
            } else {
              length = value.length;
            }
            var base = _malloc(4 + length + 1);
            var ptr = base + 4;
            HEAPU32[base >> 2] = length;
            if (stdStringIsUTF8 && valueIsOfTypeString) {
              stringToUTF8(value, ptr, length + 1);
            } else {
              if (valueIsOfTypeString) {
                for (var i = 0; i < length; ++i) {
                  var charCode = value.charCodeAt(i);
                  if (charCode > 255) {
                    _free(ptr);
                    throwBindingError("String has UTF-16 code units that do not fit in 8 bits");
                  }
                  HEAPU8[ptr + i] = charCode;
                }
              } else {
                for (var i = 0; i < length; ++i) {
                  HEAPU8[ptr + i] = value[i];
                }
              }
            }
            if (destructors !== null) {
              destructors.push(_free, base);
            }
            return base;
          }, "argPackAdvance": 8, "readValueFromPointer": simpleReadValueFromPointer, destructorFunction: function(ptr) {
            _free(ptr);
          } });
        }
        function UTF16ToString(ptr, maxBytesToRead) {
          var str = "";
          for (var i = 0; !(i >= maxBytesToRead / 2); ++i) {
            var codeUnit = HEAP16[ptr + i * 2 >> 1];
            if (codeUnit == 0) break;
            str += String.fromCharCode(codeUnit);
          }
          return str;
        }
        function stringToUTF16(str, outPtr, maxBytesToWrite) {
          if (maxBytesToWrite === void 0) {
            maxBytesToWrite = 2147483647;
          }
          if (maxBytesToWrite < 2) return 0;
          maxBytesToWrite -= 2;
          var startPtr = outPtr;
          var numCharsToWrite = maxBytesToWrite < str.length * 2 ? maxBytesToWrite / 2 : str.length;
          for (var i = 0; i < numCharsToWrite; ++i) {
            var codeUnit = str.charCodeAt(i);
            HEAP16[outPtr >> 1] = codeUnit;
            outPtr += 2;
          }
          HEAP16[outPtr >> 1] = 0;
          return outPtr - startPtr;
        }
        function lengthBytesUTF16(str) {
          return str.length * 2;
        }
        function UTF32ToString(ptr, maxBytesToRead) {
          var i = 0;
          var str = "";
          while (!(i >= maxBytesToRead / 4)) {
            var utf32 = HEAP32[ptr + i * 4 >> 2];
            if (utf32 == 0) break;
            ++i;
            if (utf32 >= 65536) {
              var ch = utf32 - 65536;
              str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
            } else {
              str += String.fromCharCode(utf32);
            }
          }
          return str;
        }
        function stringToUTF32(str, outPtr, maxBytesToWrite) {
          if (maxBytesToWrite === void 0) {
            maxBytesToWrite = 2147483647;
          }
          if (maxBytesToWrite < 4) return 0;
          var startPtr = outPtr;
          var endPtr = startPtr + maxBytesToWrite - 4;
          for (var i = 0; i < str.length; ++i) {
            var codeUnit = str.charCodeAt(i);
            if (codeUnit >= 55296 && codeUnit <= 57343) {
              var trailSurrogate = str.charCodeAt(++i);
              codeUnit = 65536 + ((codeUnit & 1023) << 10) | trailSurrogate & 1023;
            }
            HEAP32[outPtr >> 2] = codeUnit;
            outPtr += 4;
            if (outPtr + 4 > endPtr) break;
          }
          HEAP32[outPtr >> 2] = 0;
          return outPtr - startPtr;
        }
        function lengthBytesUTF32(str) {
          var len = 0;
          for (var i = 0; i < str.length; ++i) {
            var codeUnit = str.charCodeAt(i);
            if (codeUnit >= 55296 && codeUnit <= 57343) ++i;
            len += 4;
          }
          return len;
        }
        function __embind_register_std_wstring(rawType, charSize, name) {
          name = readLatin1String(name);
          var decodeString, encodeString, getHeap, lengthBytesUTF, shift;
          if (charSize === 2) {
            decodeString = UTF16ToString;
            encodeString = stringToUTF16;
            lengthBytesUTF = lengthBytesUTF16;
            getHeap = () => HEAPU16;
            shift = 1;
          } else if (charSize === 4) {
            decodeString = UTF32ToString;
            encodeString = stringToUTF32;
            lengthBytesUTF = lengthBytesUTF32;
            getHeap = () => HEAPU32;
            shift = 2;
          }
          registerType(rawType, { name, "fromWireType": function(value) {
            var length = HEAPU32[value >> 2];
            var HEAP = getHeap();
            var str;
            var decodeStartPtr = value + 4;
            for (var i = 0; i <= length; ++i) {
              var currentBytePtr = value + 4 + i * charSize;
              if (i == length || HEAP[currentBytePtr >> shift] == 0) {
                var maxReadBytes = currentBytePtr - decodeStartPtr;
                var stringSegment = decodeString(decodeStartPtr, maxReadBytes);
                if (str === void 0) {
                  str = stringSegment;
                } else {
                  str += String.fromCharCode(0);
                  str += stringSegment;
                }
                decodeStartPtr = currentBytePtr + charSize;
              }
            }
            _free(value);
            return str;
          }, "toWireType": function(destructors, value) {
            if (!(typeof value == "string")) {
              throwBindingError("Cannot pass non-string to C++ string type " + name);
            }
            var length = lengthBytesUTF(value);
            var ptr = _malloc(4 + length + charSize);
            HEAPU32[ptr >> 2] = length >> shift;
            encodeString(value, ptr + 4, length + charSize);
            if (destructors !== null) {
              destructors.push(_free, ptr);
            }
            return ptr;
          }, "argPackAdvance": 8, "readValueFromPointer": simpleReadValueFromPointer, destructorFunction: function(ptr) {
            _free(ptr);
          } });
        }
        function __embind_register_value_object(rawType, name, constructorSignature, rawConstructor, destructorSignature, rawDestructor) {
          structRegistrations[rawType] = { name: readLatin1String(name), rawConstructor: embind__requireFunction(constructorSignature, rawConstructor), rawDestructor: embind__requireFunction(destructorSignature, rawDestructor), fields: [] };
        }
        function __embind_register_value_object_field(structType, fieldName, getterReturnType, getterSignature, getter, getterContext, setterArgumentType, setterSignature, setter, setterContext) {
          structRegistrations[structType].fields.push({ fieldName: readLatin1String(fieldName), getterReturnType, getter: embind__requireFunction(getterSignature, getter), getterContext, setterArgumentType, setter: embind__requireFunction(setterSignature, setter), setterContext });
        }
        function __embind_register_void(rawType, name) {
          name = readLatin1String(name);
          registerType(rawType, { isVoid: true, name, "argPackAdvance": 0, "fromWireType": function() {
            return void 0;
          }, "toWireType": function(destructors, o) {
            return void 0;
          } });
        }
        var emval_symbols = {};
        function getStringOrSymbol(address) {
          var symbol = emval_symbols[address];
          if (symbol === void 0) {
            return readLatin1String(address);
          }
          return symbol;
        }
        function emval_get_global() {
          if (typeof globalThis == "object") {
            return globalThis;
          }
          function testGlobal(obj) {
            obj["$$$embind_global$$$"] = obj;
            var success = typeof $$$embind_global$$$ == "object" && obj["$$$embind_global$$$"] == obj;
            if (!success) {
              delete obj["$$$embind_global$$$"];
            }
            return success;
          }
          if (typeof $$$embind_global$$$ == "object") {
            return $$$embind_global$$$;
          }
          if (typeof global == "object" && testGlobal(global)) {
            $$$embind_global$$$ = global;
          } else if (typeof self == "object" && testGlobal(self)) {
            $$$embind_global$$$ = self;
          }
          if (typeof $$$embind_global$$$ == "object") {
            return $$$embind_global$$$;
          }
          throw Error("unable to get global object.");
        }
        function __emval_get_global(name) {
          if (name === 0) {
            return Emval.toHandle(emval_get_global());
          } else {
            name = getStringOrSymbol(name);
            return Emval.toHandle(emval_get_global()[name]);
          }
        }
        function __emval_incref(handle) {
          if (handle > 4) {
            emval_handle_array[handle].refcount += 1;
          }
        }
        function craftEmvalAllocator(argCount) {
          var argsList = new Array(argCount + 1);
          return function(constructor, argTypes, args) {
            argsList[0] = constructor;
            for (var i = 0; i < argCount; ++i) {
              var argType = requireRegisteredType(HEAPU32[argTypes + i * 4 >> 2], "parameter " + i);
              argsList[i + 1] = argType["readValueFromPointer"](args);
              args += argType["argPackAdvance"];
            }
            var obj = new (constructor.bind.apply(constructor, argsList))();
            return Emval.toHandle(obj);
          };
        }
        var emval_newers = {};
        function __emval_new(handle, argCount, argTypes, args) {
          handle = Emval.toValue(handle);
          var newer = emval_newers[argCount];
          if (!newer) {
            newer = craftEmvalAllocator(argCount);
            emval_newers[argCount] = newer;
          }
          return newer(handle, argTypes, args);
        }
        function _abort() {
          abort("");
        }
        function _emscripten_memcpy_big(dest, src, num) {
          HEAPU8.copyWithin(dest, src, src + num);
        }
        function getHeapMax() {
          return 2147483648;
        }
        function emscripten_realloc_buffer(size) {
          var b = wasmMemory.buffer;
          try {
            wasmMemory.grow(size - b.byteLength + 65535 >>> 16);
            updateMemoryViews();
            return 1;
          } catch (e) {
          }
        }
        function _emscripten_resize_heap(requestedSize) {
          var oldSize = HEAPU8.length;
          requestedSize = requestedSize >>> 0;
          var maxHeapSize = getHeapMax();
          if (requestedSize > maxHeapSize) {
            return false;
          }
          let alignUp = (x, multiple) => x + (multiple - x % multiple) % multiple;
          for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
            var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
            overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
            var newSize = Math.min(maxHeapSize, alignUp(Math.max(requestedSize, overGrownHeapSize), 65536));
            var replacement = emscripten_realloc_buffer(newSize);
            if (replacement) {
              return true;
            }
          }
          return false;
        }
        InternalError = Module3["InternalError"] = extendError(Error, "InternalError");
        embind_init_charCodes();
        BindingError = Module3["BindingError"] = extendError(Error, "BindingError");
        init_emval();
        UnboundTypeError = Module3["UnboundTypeError"] = extendError(Error, "UnboundTypeError");
        var wasmImports = { "k": ___cxa_throw, "m": __embind_finalize_value_object, "o": __embind_register_bigint, "t": __embind_register_bool, "s": __embind_register_emval, "q": __embind_register_enum, "d": __embind_register_enum_value, "h": __embind_register_float, "f": __embind_register_function, "c": __embind_register_integer, "b": __embind_register_memory_view, "i": __embind_register_std_string, "e": __embind_register_std_wstring, "n": __embind_register_value_object, "a": __embind_register_value_object_field, "u": __embind_register_void, "j": __emval_decref, "w": __emval_get_global, "l": __emval_incref, "v": __emval_new, "g": _abort, "r": _emscripten_memcpy_big, "p": _emscripten_resize_heap };
        var asm = createWasm();
        var ___wasm_call_ctors = function() {
          return (___wasm_call_ctors = Module3["asm"]["y"]).apply(null, arguments);
        };
        var _malloc = function() {
          return (_malloc = Module3["asm"]["z"]).apply(null, arguments);
        };
        var _free = function() {
          return (_free = Module3["asm"]["A"]).apply(null, arguments);
        };
        var ___getTypeName = Module3["___getTypeName"] = function() {
          return (___getTypeName = Module3["___getTypeName"] = Module3["asm"]["B"]).apply(null, arguments);
        };
        var __embind_initialize_bindings = Module3["__embind_initialize_bindings"] = function() {
          return (__embind_initialize_bindings = Module3["__embind_initialize_bindings"] = Module3["asm"]["C"]).apply(null, arguments);
        };
        var ___errno_location = function() {
          return (___errno_location = Module3["asm"]["__errno_location"]).apply(null, arguments);
        };
        var ___cxa_is_pointer_type = function() {
          return (___cxa_is_pointer_type = Module3["asm"]["E"]).apply(null, arguments);
        };
        var calledRun;
        dependenciesFulfilled = function runCaller() {
          if (!calledRun) run();
          if (!calledRun) dependenciesFulfilled = runCaller;
        };
        function run() {
          if (runDependencies > 0) {
            return;
          }
          preRun();
          if (runDependencies > 0) {
            return;
          }
          function doRun() {
            if (calledRun) return;
            calledRun = true;
            Module3["calledRun"] = true;
            if (ABORT) return;
            initRuntime();
            readyPromiseResolve(Module3);
            if (Module3["onRuntimeInitialized"]) Module3["onRuntimeInitialized"]();
            postRun();
          }
          if (Module3["setStatus"]) {
            Module3["setStatus"]("Running...");
            setTimeout(function() {
              setTimeout(function() {
                Module3["setStatus"]("");
              }, 1);
              doRun();
            }, 1);
          } else {
            doRun();
          }
        }
        if (Module3["preInit"]) {
          if (typeof Module3["preInit"] == "function") Module3["preInit"] = [Module3["preInit"]];
          while (Module3["preInit"].length > 0) {
            Module3["preInit"].pop()();
          }
        }
        run();
        return Module3.ready;
      });
    })();
    webp_enc_default = Module2;
  }
});

// ../admin/node_modules/.pnpm/@jsquash+webp@1.5.0/node_modules/@jsquash/webp/meta.js
var defaultOptions = {
  quality: 75,
  target_size: 0,
  target_PSNR: 0,
  method: 4,
  sns_strength: 50,
  filter_strength: 60,
  filter_sharpness: 0,
  filter_type: 1,
  partitions: 0,
  segments: 4,
  pass: 1,
  show_compressed: 0,
  preprocessing: 0,
  autofilter: 0,
  partition_limit: 0,
  alpha_compression: 1,
  alpha_filtering: 1,
  alpha_quality: 100,
  lossless: 0,
  exact: 0,
  image_hint: 0,
  emulate_jpeg_size: 0,
  thread_level: 0,
  low_memory: 0,
  near_lossless: 100,
  use_delta_palette: 0,
  use_sharp_yuv: 0
};

// ../admin/node_modules/.pnpm/@jsquash+webp@1.5.0/node_modules/@jsquash/webp/utils.js
function initEmscriptenModule(moduleFactory, wasmModule, moduleOptionOverrides = {}) {
  let instantiateWasm;
  if (wasmModule) {
    instantiateWasm = (imports, callback) => {
      const instance = new WebAssembly.Instance(wasmModule, imports);
      callback(instance);
      return instance.exports;
    };
  }
  return moduleFactory({
    // Just to be safe, don't automatically invoke any wasm functions
    noInitialRun: true,
    instantiateWasm,
    ...moduleOptionOverrides
  });
}

// ../admin/node_modules/.pnpm/wasm-feature-detect@1.10.1/node_modules/wasm-feature-detect/dist/esm/index.js
var simd = async () => WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));

// ../admin/node_modules/.pnpm/@jsquash+webp@1.5.0/node_modules/@jsquash/webp/encode.js
var emscriptenModule;
async function init(module, moduleOptionOverrides) {
  let actualModule = module;
  let actualOptions = moduleOptionOverrides;
  if (arguments.length === 1 && !(module instanceof WebAssembly.Module)) {
    actualModule = void 0;
    actualOptions = module;
  }
  if (await simd()) {
    const webpEncoder2 = await Promise.resolve().then(() => (init_webp_enc_simd(), webp_enc_simd_exports));
    emscriptenModule = initEmscriptenModule(webpEncoder2.default, actualModule, actualOptions);
    return emscriptenModule;
  }
  const webpEncoder = await Promise.resolve().then(() => (init_webp_enc(), webp_enc_exports));
  emscriptenModule = initEmscriptenModule(webpEncoder.default, actualModule, actualOptions);
  return emscriptenModule;
}
async function encode(data, options = {}) {
  if (!emscriptenModule)
    emscriptenModule = init();
  const _options = { ...defaultOptions, ...options };
  const module = await emscriptenModule;
  const result = module.encode(data.data, data.width, data.height, _options);
  if (!result)
    throw new Error("Encoding error.");
  return result.buffer;
}

// ../admin/node_modules/.pnpm/@jsquash+resize@2.1.1/node_modules/@jsquash/resize/util.js
function getContainOffsets(sw, sh, dw, dh) {
  const currentAspect = sw / sh;
  const endAspect = dw / dh;
  if (endAspect > currentAspect) {
    const newSh = sw / endAspect;
    const newSy = (sh - newSh) / 2;
    return { sw, sh: newSh, sx: 0, sy: newSy };
  }
  const newSw = sh * endAspect;
  const newSx = (sw - newSw) / 2;
  return { sh, sw: newSw, sx: newSx, sy: 0 };
}

// ../admin/node_modules/.pnpm/@jsquash+resize@2.1.1/node_modules/@jsquash/resize/lib/resize/pkg/squoosh_resize.js
var wasm;
var cachedUint8Memory0 = null;
function getUint8Memory0() {
  if (cachedUint8Memory0 === null || cachedUint8Memory0.byteLength === 0) {
    cachedUint8Memory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8Memory0;
}
var WASM_VECTOR_LEN = 0;
function passArray8ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 1, 1) >>> 0;
  getUint8Memory0().set(arg, ptr / 1);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}
var cachedInt32Memory0 = null;
function getInt32Memory0() {
  if (cachedInt32Memory0 === null || cachedInt32Memory0.byteLength === 0) {
    cachedInt32Memory0 = new Int32Array(wasm.memory.buffer);
  }
  return cachedInt32Memory0;
}
var cachedUint8ClampedMemory0 = null;
function getUint8ClampedMemory0() {
  if (cachedUint8ClampedMemory0 === null || cachedUint8ClampedMemory0.byteLength === 0) {
    cachedUint8ClampedMemory0 = new Uint8ClampedArray(wasm.memory.buffer);
  }
  return cachedUint8ClampedMemory0;
}
function getClampedArrayU8FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getUint8ClampedMemory0().subarray(ptr / 1, ptr / 1 + len);
}
function resize(input_image, input_width, input_height, output_width, output_height, typ_idx, premultiply, color_space_conversion) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passArray8ToWasm0(input_image, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.resize(retptr, ptr0, len0, input_width, input_height, output_width, output_height, typ_idx, premultiply, color_space_conversion);
    var r0 = getInt32Memory0()[retptr / 4 + 0];
    var r1 = getInt32Memory0()[retptr / 4 + 1];
    var v2 = getClampedArrayU8FromWasm0(r0, r1).slice();
    wasm.__wbindgen_free(r0, r1 * 1, 1);
    return v2;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
async function __wbg_load(module, imports) {
  if (typeof Response === "function" && module instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === "function") {
      try {
        return await WebAssembly.instantiateStreaming(module, imports);
      } catch (e) {
        if (module.headers.get("Content-Type") != "application/wasm") {
          console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
        } else {
          throw e;
        }
      }
    }
    const bytes = await module.arrayBuffer();
    return await WebAssembly.instantiate(bytes, imports);
  } else {
    const instance = await WebAssembly.instantiate(module, imports);
    if (instance instanceof WebAssembly.Instance) {
      return { instance, module };
    } else {
      return instance;
    }
  }
}
function __wbg_get_imports() {
  const imports = {};
  imports.wbg = {};
  return imports;
}
function __wbg_init_memory(imports, maybe_memory) {
}
function __wbg_finalize_init(instance, module) {
  wasm = instance.exports;
  __wbg_init.__wbindgen_wasm_module = module;
  cachedInt32Memory0 = null;
  cachedUint8Memory0 = null;
  cachedUint8ClampedMemory0 = null;
  return wasm;
}
async function __wbg_init(input) {
  if (wasm !== void 0) return wasm;
  if (typeof input === "undefined") {
    input = new URL("squoosh_resize_bg.wasm", import.meta.url);
  }
  const imports = __wbg_get_imports();
  if (typeof input === "string" || typeof Request === "function" && input instanceof Request || typeof URL === "function" && input instanceof URL) {
    input = fetch(input);
  }
  __wbg_init_memory(imports);
  const { instance, module } = await __wbg_load(await input, imports);
  return __wbg_finalize_init(instance, module);
}
var squoosh_resize_default = __wbg_init;
var isServiceWorker = globalThis.ServiceWorkerGlobalScope !== void 0;
var isRunningInCloudFlareWorkers = isServiceWorker && typeof self !== "undefined" && globalThis.caches && globalThis.caches.default !== void 0;
var isRunningInNode = typeof process === "object" && process.release && process.release.name === "node";
if (isRunningInCloudFlareWorkers || isRunningInNode) {
  if (!globalThis.ImageData) {
    globalThis.ImageData = class ImageData {
      constructor(data, width, height) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    };
  }
  if (import.meta.url === void 0) {
    import.meta.url = "https://localhost";
  }
  if (typeof self !== "undefined" && self.location === void 0) {
    self.location = { href: "" };
  }
}

// ../admin/node_modules/.pnpm/@jsquash+resize@2.1.1/node_modules/@jsquash/resize/lib/hqx/pkg/squooshhqx.js
var wasm2;
var cachedUint32Memory0 = null;
function getUint32Memory0() {
  if (cachedUint32Memory0 === null || cachedUint32Memory0.byteLength === 0) {
    cachedUint32Memory0 = new Uint32Array(wasm2.memory.buffer);
  }
  return cachedUint32Memory0;
}
var WASM_VECTOR_LEN2 = 0;
function passArray32ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 4, 4) >>> 0;
  getUint32Memory0().set(arg, ptr / 4);
  WASM_VECTOR_LEN2 = arg.length;
  return ptr;
}
var cachedInt32Memory02 = null;
function getInt32Memory02() {
  if (cachedInt32Memory02 === null || cachedInt32Memory02.byteLength === 0) {
    cachedInt32Memory02 = new Int32Array(wasm2.memory.buffer);
  }
  return cachedInt32Memory02;
}
function getArrayU32FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getUint32Memory0().subarray(ptr / 4, ptr / 4 + len);
}
function resize2(input_image, input_width, input_height, factor) {
  try {
    const retptr = wasm2.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passArray32ToWasm0(input_image, wasm2.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN2;
    wasm2.resize(retptr, ptr0, len0, input_width, input_height, factor);
    var r0 = getInt32Memory02()[retptr / 4 + 0];
    var r1 = getInt32Memory02()[retptr / 4 + 1];
    var v2 = getArrayU32FromWasm0(r0, r1).slice();
    wasm2.__wbindgen_free(r0, r1 * 4, 4);
    return v2;
  } finally {
    wasm2.__wbindgen_add_to_stack_pointer(16);
  }
}
async function __wbg_load2(module, imports) {
  if (typeof Response === "function" && module instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === "function") {
      try {
        return await WebAssembly.instantiateStreaming(module, imports);
      } catch (e) {
        if (module.headers.get("Content-Type") != "application/wasm") {
          console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
        } else {
          throw e;
        }
      }
    }
    const bytes = await module.arrayBuffer();
    return await WebAssembly.instantiate(bytes, imports);
  } else {
    const instance = await WebAssembly.instantiate(module, imports);
    if (instance instanceof WebAssembly.Instance) {
      return { instance, module };
    } else {
      return instance;
    }
  }
}
function __wbg_get_imports2() {
  const imports = {};
  imports.wbg = {};
  return imports;
}
function __wbg_init_memory2(imports, maybe_memory) {
}
function __wbg_finalize_init2(instance, module) {
  wasm2 = instance.exports;
  __wbg_init2.__wbindgen_wasm_module = module;
  cachedInt32Memory02 = null;
  cachedUint32Memory0 = null;
  return wasm2;
}
async function __wbg_init2(input) {
  if (wasm2 !== void 0) return wasm2;
  if (typeof input === "undefined") {
    input = new URL("squooshhqx_bg.wasm", import.meta.url);
  }
  const imports = __wbg_get_imports2();
  if (typeof input === "string" || typeof Request === "function" && input instanceof Request || typeof URL === "function" && input instanceof URL) {
    input = fetch(input);
  }
  __wbg_init_memory2(imports);
  const { instance, module } = await __wbg_load2(await input, imports);
  return __wbg_finalize_init2(instance, module);
}
var squooshhqx_default = __wbg_init2;
var isServiceWorker2 = globalThis.ServiceWorkerGlobalScope !== void 0;
var isRunningInCloudFlareWorkers2 = isServiceWorker2 && typeof self !== "undefined" && globalThis.caches && globalThis.caches.default !== void 0;
var isRunningInNode2 = typeof process === "object" && process.release && process.release.name === "node";
if (isRunningInCloudFlareWorkers2 || isRunningInNode2) {
  if (!globalThis.ImageData) {
    globalThis.ImageData = class ImageData {
      constructor(data, width, height) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    };
  }
  if (import.meta.url === void 0) {
    import.meta.url = "https://localhost";
  }
  if (typeof self !== "undefined" && self.location === void 0) {
    self.location = { href: "" };
  }
}

// ../admin/node_modules/.pnpm/@jsquash+resize@2.1.1/node_modules/@jsquash/resize/lib/magic-kernel/pkg/jsquash_magic_kernel.js
var wasm3;
function getClampedArrayU8FromWasm02(ptr, len) {
  ptr = ptr >>> 0;
  return getUint8ClampedArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}
var cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
  if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasm3.memory.buffer);
  }
  return cachedUint8ArrayMemory0;
}
var cachedUint8ClampedArrayMemory0 = null;
function getUint8ClampedArrayMemory0() {
  if (cachedUint8ClampedArrayMemory0 === null || cachedUint8ClampedArrayMemory0.byteLength === 0) {
    cachedUint8ClampedArrayMemory0 = new Uint8ClampedArray(wasm3.memory.buffer);
  }
  return cachedUint8ClampedArrayMemory0;
}
function passArray8ToWasm02(arg, malloc) {
  const ptr = malloc(arg.length * 1, 1) >>> 0;
  getUint8ArrayMemory0().set(arg, ptr / 1);
  WASM_VECTOR_LEN3 = arg.length;
  return ptr;
}
function passStringToWasm0(arg, malloc, realloc) {
  if (realloc === void 0) {
    const buf = cachedTextEncoder.encode(arg);
    const ptr2 = malloc(buf.length, 1) >>> 0;
    getUint8ArrayMemory0().subarray(ptr2, ptr2 + buf.length).set(buf);
    WASM_VECTOR_LEN3 = buf.length;
    return ptr2;
  }
  let len = arg.length;
  let ptr = malloc(len, 1) >>> 0;
  const mem = getUint8ArrayMemory0();
  let offset = 0;
  for (; offset < len; offset++) {
    const code = arg.charCodeAt(offset);
    if (code > 127) break;
    mem[ptr + offset] = code;
  }
  if (offset !== len) {
    if (offset !== 0) {
      arg = arg.slice(offset);
    }
    ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
    const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
    const ret = cachedTextEncoder.encodeInto(arg, view);
    offset += ret.written;
    ptr = realloc(ptr, len, offset, 1) >>> 0;
  }
  WASM_VECTOR_LEN3 = offset;
  return ptr;
}
var cachedTextEncoder = new TextEncoder();
if (!("encodeInto" in cachedTextEncoder)) {
  cachedTextEncoder.encodeInto = function(arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
      read: arg.length,
      written: buf.length
    };
  };
}
var WASM_VECTOR_LEN3 = 0;
function resize3(data, input_width, input_height, output_width, output_height, version) {
  const ptr0 = passArray8ToWasm02(data, wasm3.__wbindgen_malloc);
  const len0 = WASM_VECTOR_LEN3;
  const ptr1 = passStringToWasm0(version, wasm3.__wbindgen_malloc, wasm3.__wbindgen_realloc);
  const len1 = WASM_VECTOR_LEN3;
  const ret = wasm3.resize(ptr0, len0, input_width, input_height, output_width, output_height, ptr1, len1);
  return ret;
}
var EXPECTED_RESPONSE_TYPES = /* @__PURE__ */ new Set(["basic", "cors", "default"]);
async function __wbg_load3(module, imports) {
  if (typeof Response === "function" && module instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === "function") {
      try {
        return await WebAssembly.instantiateStreaming(module, imports);
      } catch (e) {
        const validResponse = module.ok && EXPECTED_RESPONSE_TYPES.has(module.type);
        if (validResponse && module.headers.get("Content-Type") !== "application/wasm") {
          console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
        } else {
          throw e;
        }
      }
    }
    const bytes = await module.arrayBuffer();
    return await WebAssembly.instantiate(bytes, imports);
  } else {
    const instance = await WebAssembly.instantiate(module, imports);
    if (instance instanceof WebAssembly.Instance) {
      return { instance, module };
    } else {
      return instance;
    }
  }
}
function __wbg_get_imports3() {
  const imports = {};
  imports.wbg = {};
  imports.wbg.__wbg_new_with_owned_u8_clamped_array_and_sh_e8143e95833a3ec3 = function(arg0, arg1, arg2, arg3) {
    var v0 = getClampedArrayU8FromWasm02(arg0, arg1).slice();
    wasm3.__wbindgen_free(arg0, arg1 * 1, 1);
    const ret = new ImageData(v0, arg2 >>> 0, arg3 >>> 0);
    return ret;
  };
  imports.wbg.__wbindgen_init_externref_table = function() {
    const table = wasm3.__wbindgen_externrefs;
    const offset = table.grow(4);
    table.set(0, void 0);
    table.set(offset + 0, void 0);
    table.set(offset + 1, null);
    table.set(offset + 2, true);
    table.set(offset + 3, false);
  };
  return imports;
}
function __wbg_finalize_init3(instance, module) {
  wasm3 = instance.exports;
  __wbg_init3.__wbindgen_wasm_module = module;
  cachedUint8ArrayMemory0 = null;
  cachedUint8ClampedArrayMemory0 = null;
  wasm3.__wbindgen_start();
  return wasm3;
}
async function __wbg_init3(module_or_path) {
  if (wasm3 !== void 0) return wasm3;
  if (typeof module_or_path !== "undefined") {
    if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
      ({ module_or_path } = module_or_path);
    } else {
      console.warn("using deprecated parameters for the initialization function; pass a single object instead");
    }
  }
  if (typeof module_or_path === "undefined") {
    module_or_path = new URL("jsquash_magic_kernel_bg.wasm", import.meta.url);
  }
  const imports = __wbg_get_imports3();
  if (typeof module_or_path === "string" || typeof Request === "function" && module_or_path instanceof Request || typeof URL === "function" && module_or_path instanceof URL) {
    module_or_path = fetch(module_or_path);
  }
  const { instance, module } = await __wbg_load3(await module_or_path, imports);
  return __wbg_finalize_init3(instance, module);
}
var jsquash_magic_kernel_default = __wbg_init3;
var isServiceWorker3 = globalThis.ServiceWorkerGlobalScope !== void 0;
var isRunningInCloudFlareWorkers3 = isServiceWorker3 && typeof self !== "undefined" && globalThis.caches && globalThis.caches.default !== void 0;
var isRunningInNode3 = typeof process === "object" && process.release && process.release.name === "node";
if (isRunningInCloudFlareWorkers3 || isRunningInNode3) {
  if (!globalThis.ImageData) {
    globalThis.ImageData = class ImageData {
      constructor(data, width, height) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    };
  }
  if (import.meta.url === void 0) {
    import.meta.url = "https://localhost";
  }
  if (typeof self !== "undefined" && self.location === void 0) {
    self.location = { href: "" };
  }
}

// ../admin/node_modules/.pnpm/@jsquash+resize@2.1.1/node_modules/@jsquash/resize/meta.js
var defaultOptions2 = {
  // Width and height will always default to the image size.
  // This is set elsewhere.
  width: 1,
  height: 1,
  // This will be set to 'vector' if the input is SVG.
  method: "lanczos3",
  fitMethod: "stretch",
  premultiply: true,
  linearRGB: true
};

// ../admin/node_modules/.pnpm/@jsquash+resize@2.1.1/node_modules/@jsquash/resize/index.js
var MAGIC_KERNEL_METHODS = [
  "magicKernel",
  "magicKernelSharp2013",
  "magicKernelSharp2021"
];
var resizeWasmReady;
var hqxWasmReady;
var magicKernelWasmReady;
function initResize(moduleOrPath) {
  if (!resizeWasmReady) {
    resizeWasmReady = squoosh_resize_default(moduleOrPath);
  }
  return resizeWasmReady;
}
function initHqx(moduleOrPath) {
  if (!hqxWasmReady) {
    hqxWasmReady = squooshhqx_default(moduleOrPath);
  }
  return hqxWasmReady;
}
function initMagicKernel(moduleOrPath) {
  if (!magicKernelWasmReady) {
    magicKernelWasmReady = jsquash_magic_kernel_default(moduleOrPath);
  }
  return magicKernelWasmReady;
}
function optsIsHqxOpts(opts) {
  return opts.method === "hqx";
}
function optsIsMagicKernelOpts(opts) {
  return MAGIC_KERNEL_METHODS.includes(opts.method);
}
function crop(data, sx, sy, sw, sh) {
  const inputPixels = new Uint32Array(data.data.buffer);
  for (let y = 0; y < sh; y += 1) {
    const start = (y + sy) * data.width + sx;
    inputPixels.copyWithin(y * sw, start, start + sw);
  }
  return new ImageData(new Uint8ClampedArray(inputPixels.buffer.slice(0, sw * sh * 4)), sw, sh);
}
function clamp(num, { min = Number.MIN_VALUE, max = Number.MAX_VALUE }) {
  return Math.min(Math.max(num, min), max);
}
var resizeMethods = [
  "triangle",
  "catrom",
  "mitchell",
  "lanczos3"
];
async function hqx(input, opts) {
  await initHqx();
  const widthRatio = opts.width / input.width;
  const heightRatio = opts.height / input.height;
  const ratio = Math.max(widthRatio, heightRatio);
  const factor = clamp(Math.ceil(ratio), { min: 1, max: 4 });
  if (factor === 1)
    return input;
  const result = resize2(new Uint32Array(input.data.buffer), input.width, input.height, factor);
  return new ImageData(new Uint8ClampedArray(result.buffer), input.width * factor, input.height * factor);
}
async function magicKernel(input, opts) {
  await initMagicKernel();
  const result = resize3(new Uint8Array(input.data.buffer), input.width, input.height, opts.width, opts.height, opts.method);
  return result;
}
async function resize4(data, overrideOptions) {
  let options = {
    ...defaultOptions2,
    ...overrideOptions
  };
  let input = data;
  initResize();
  if (optsIsHqxOpts(options)) {
    input = await hqx(input, options);
    options = { ...options, method: "catrom" };
  }
  await resizeWasmReady;
  if (options.fitMethod === "contain") {
    const { sx, sy, sw, sh } = getContainOffsets(data.width, data.height, options.width, options.height);
    input = crop(input, Math.round(sx), Math.round(sy), Math.round(sw), Math.round(sh));
  }
  if (optsIsMagicKernelOpts(options)) {
    return magicKernel(input, options);
  }
  const result = resize(new Uint8Array(input.data.buffer), input.width, input.height, options.width, options.height, resizeMethods.indexOf(options.method), options.premultiply, options.linearRGB);
  return new ImageData(new Uint8ClampedArray(result.buffer), options.width, options.height);
}

// ../admin/src/utils/webpEncoder.worker.ts
var PRISTINE_STUDIO_PRESET = {
  quality: 92,
  method: 6,
  pass: 10,
  use_sharp_yuv: 1,
  sns_strength: 80,
  filter_sharpness: 4,
  filter_strength: 25,
  autofilter: 1,
  preprocessing: 4,
  alpha_compression: 1
};
var MAX_DIMENSION = 2560;
var initPromise = null;
async function supportsWasmSimd() {
  try {
    return WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])
    );
  } catch {
    return false;
  }
}
async function initModules() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const hasSimd = await supportsWasmSimd();
    const webpWasmPath = hasSimd ? "/admin/assets/wasm/webp_enc_simd.wasm" : "/admin/assets/wasm/webp_enc.wasm";
    const resizeWasmPath = "/admin/assets/wasm/squoosh_resize_bg.wasm";
    const [webpRes, resizeRes] = await Promise.all([
      fetch(webpWasmPath, { credentials: "omit" }),
      fetch(resizeWasmPath, { credentials: "omit" })
    ]);
    if (!webpRes.ok) {
      throw new Error(`Failed to load WebP wasm binary from ${webpWasmPath} (HTTP ${webpRes.status})`);
    }
    if (!resizeRes.ok) {
      throw new Error(`Failed to load Resize wasm binary from ${resizeWasmPath} (HTTP ${resizeRes.status})`);
    }
    const [webpBytes, resizeBytes] = await Promise.all([
      webpRes.arrayBuffer(),
      resizeRes.arrayBuffer()
    ]);
    const [webpModule, resizeModule] = await Promise.all([
      WebAssembly.compile(webpBytes),
      WebAssembly.compile(resizeBytes)
    ]);
    await Promise.all([
      init(webpModule),
      initResize(resizeModule)
    ]);
  })();
  return initPromise;
}
self.onmessage = async (e) => {
  const { id, rgbaBuffer, width, height, targetWidth, targetHeight, quality } = e.data;
  try {
    if (!rgbaBuffer || !width || !height) {
      throw new Error("Invalid worker input: rgbaBuffer, width, and height are required");
    }
    await initModules();
    let finalWidth = targetWidth;
    let finalHeight = targetHeight;
    if (!finalWidth || !finalHeight) {
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / Math.max(width, height);
        finalWidth = Math.round(width * scale);
        finalHeight = Math.round(height * scale);
      } else {
        finalWidth = width;
        finalHeight = height;
      }
    }
    const needsResize = width > MAX_DIMENSION || height > MAX_DIMENSION || (finalWidth !== width || finalHeight !== height);
    const initialImageData = new ImageData(
      new Uint8ClampedArray(rgbaBuffer),
      width,
      height
    );
    let preparedImageData;
    if (needsResize && (finalWidth !== width || finalHeight !== height)) {
      preparedImageData = await resize4(initialImageData, {
        width: finalWidth,
        height: finalHeight,
        method: "lanczos3",
        premultiply: true,
        linearRGB: true
      });
    } else {
      preparedImageData = initialImageData;
    }
    const targetQuality = typeof quality === "number" && Number.isFinite(quality) ? Math.max(1, Math.min(100, Math.round(quality <= 1 ? quality * 100 : quality))) : PRISTINE_STUDIO_PRESET.quality;
    const webpBuffer = await encode(preparedImageData, {
      ...PRISTINE_STUDIO_PRESET,
      quality: targetQuality
    });
    self.postMessage(
      {
        id,
        success: true,
        webpBuffer,
        width: preparedImageData.width,
        height: preparedImageData.height
      },
      [webpBuffer]
    );
  } catch (err) {
    self.postMessage({
      id,
      success: false,
      error: err?.message || String(err)
    });
  }
};
