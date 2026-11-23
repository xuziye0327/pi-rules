import { createRequire } from "node:module";
import * as nodeFs from "node:fs";
import path, { posix, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
// \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod, mod.exports), cb = null), mod.exports);
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
var __require = /* #__PURE__ */ (() => createRequire(import.meta.url))();
// src/rules/paths.ts
function slash(input) {
	return input.replaceAll("\\", "/");
}
function isWithin(root, target) {
	const relative = path.relative(root, target);
	return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function physicalPath(input, cwd, fs = nodeFs) {
	let current = path.resolve(cwd, input);
	const missing = [];
	for (;;) try {
		return slash(path.resolve(fs.realpathSync(current), ...missing));
	} catch (error) {
		const code = error.code;
		if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
		const parent = path.dirname(current);
		if (parent === current) throw error;
		missing.unshift(path.basename(current));
		current = parent;
	}
}
// src/commands.ts
var subcommands = [
	"list",
	"show",
	"paths",
	"status"
];
function ruleCompletions(prefix) {
	const items = subcommands.filter((command) => command.startsWith(prefix));
	return items.length ? items.map((value) => ({
		value,
		label: value
	})) : null;
}
function uniqueRules(snapshot) {
	const seen = /* @__PURE__ */ new Set();
	return snapshot.known.filter((rule) => {
		if (seen.has(rule.realPath)) return false;
		seen.add(rule.realPath);
		return true;
	});
}
function rulesSummary(snapshot) {
	return `[pi-rules] known=${uniqueRules(snapshot).length} activated=${snapshot.activated.length} injected=${snapshot.injected.size} warnings=${snapshot.warnings.length}`;
}
function rulesCommand(args, snapshot) {
	const parsed = /^(\S+)(?:\s+([\s\S]*))?$/.exec(args.trim());
	if (!parsed) return rulesSummary(snapshot);
	const [, command, rest = ""] = parsed;
	const known = uniqueRules(snapshot);
	if (command === "paths") return known.map((rule) => rule.realPath).join("\n") || "[pi-rules] No known rules.";
	if (command === "list") {
		const active = new Set(snapshot.activated.map((rule) => rule.realPath));
		return snapshot.known.map((item) => {
			const injected = item.rule ? snapshot.injected.has(item.rule.ruleKey) : false;
			const match = item.matchReason ? `${item.matchReason} for ${item.targets?.join(", ")}` : "none (last edit/write targets)";
			return `${item.realPath}\n  source=${item.source} active=${active.has(item.realPath)} injected=${injected} match=${match}${item.error ? ` unreadable=${item.error}` : ""}`;
		}).join("\n") || "[pi-rules] No known rules.";
	}
	if (command === "show") {
		let id = rest.trim();
		if (id.length >= 2 && (id.startsWith("\"") && id.endsWith("\"") || id.startsWith("'") && id.endsWith("'"))) id = id.slice(1, -1);
		if (!id) return "Usage: /rules show <absolute real path, relative path or unique suffix>";
		const key = slash(id);
		const exact = known.filter((item) => slash(item.realPath) === key);
		const found = exact.length ? exact : known.filter((item) => slash(item.relativePath) === key || slash(item.realPath).endsWith(`/${key}`) || slash(item.discoveredPath).endsWith(`/${key}`));
		if (found.length > 1) return `Ambiguous rule ID:\n${found.map((item) => item.realPath).join("\n")}`;
		if (!found.length) return `Unknown rule: ${id}`;
		const item = found[0];
		return item.error ? `Cannot read ${item.realPath}: ${item.error}` : `${item.realPath}\n${item.rule?.body ?? ""}`;
	}
	if (command === "status") {
		const { config } = snapshot;
		const details = Object.entries(snapshot.diagnostics).flatMap(([domain, items]) => items.map((item) => `[${domain}] ${item.severity} ${item.code} ${item.source}: ${item.message}`));
		return [
			rulesSummary(snapshot),
			`mode=${config.mode} disabled=${config.disabled} widget=${config.widget}`,
			`maxRuleChars=${config.maxRuleChars} maxResultChars=${config.maxResultChars}`,
			`sessionRoot=${snapshot.sessionRoot}`,
			...details
		].join("\n");
	}
	return "Usage: /rules [list|show <id>|paths|status]";
}
// src/rules/config.ts
/** Resolve an environment snapshot and the current flags without accessing globals. */
function readConfiguration(env, flags) {
	const diagnostics = [];
	const warn = (source, message) => {
		diagnostics.push({
			severity: "warning",
			code: "invalid-config",
			source,
			message
		});
	};
	const budget = (source, fallback) => {
		const raw = env[source];
		if (raw === void 0) return fallback;
		const value = raw.trim();
		const parsed = Number(value);
		if (/^[0-9]+$/.test(value) && Number.isSafeInteger(parsed) && parsed > 0) return parsed;
		warn(source, `Expected a positive decimal safe integer; using ${fallback}.`);
		return fallback;
	};
	const maxRuleChars = budget("PI_RULES_MAX_RULE_CHARS", 12e3);
	const maxResultChars = budget("PI_RULES_MAX_RESULT_CHARS", 4e4);
	let mode = "both";
	if (flags.mode !== void 0) {
		if (flags.mode === "static" || flags.mode === "dynamic" || flags.mode === "both" || flags.mode === "off") mode = flags.mode;
		else warn("--pi-rules-mode", "Expected static, dynamic, both, or off; using both.");
	}
	let widget = true;
	if (flags.widget !== void 0) {
		if (flags.widget === "true" || flags.widget === "false") widget = flags.widget === "true";
		else warn("--pi-rules-widget", "Expected the string true or false; using true.");
	}
	if (flags.disabled !== void 0 && typeof flags.disabled !== "boolean") warn("--pi-rules-disabled", "Expected a boolean presence flag; using false for the flag.");
	const environmentDisabled = [
		"1",
		"true",
		"yes",
		"on"
	].includes((env.PI_RULES_DISABLED ?? "").trim().toLowerCase());
	return {
		config: {
			mode,
			widget,
			disabled: environmentDisabled || flags.disabled === true,
			maxRuleChars,
			maxResultChars
		},
		diagnostics
	};
}
// src/rules/diagnostics.ts
function uniqueDiagnostics(items) {
	const seen = /* @__PURE__ */ new Set();
	return items.filter((item) => {
		const key = JSON.stringify([
			item.code,
			item.source,
			item.message
		]);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
function warning(code, source, error) {
	return {
		severity: "warning",
		code,
		source,
		message: error instanceof Error ? error.message : String(error)
	};
}
// node_modules/js-yaml/lib/js-yaml/common.js
var require_common = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	function isNothing(subject) {
		return typeof subject === "undefined" || subject === null;
	}
	function isObject(subject) {
		return typeof subject === "object" && subject !== null;
	}
	function toArray(sequence) {
		if (Array.isArray(sequence)) return sequence;
		else if (isNothing(sequence)) return [];
		return [sequence];
	}
	function extend(target, source) {
		var index, length, key, sourceKeys;
		if (source) {
			sourceKeys = Object.keys(source);
			for (index = 0, length = sourceKeys.length; index < length; index += 1) {
				key = sourceKeys[index];
				target[key] = source[key];
			}
		}
		return target;
	}
	function repeat(string, count) {
		var result = "", cycle = 0;
		for (; cycle < count; cycle += 1) result += string;
		return result;
	}
	function isNegativeZero(number) {
		return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
	}
	module.exports.isNothing = isNothing;
	module.exports.isObject = isObject;
	module.exports.toArray = toArray;
	module.exports.repeat = repeat;
	module.exports.isNegativeZero = isNegativeZero;
	module.exports.extend = extend;
}));
// node_modules/js-yaml/lib/js-yaml/exception.js
var require_exception = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	function YAMLException(reason, mark) {
		Error.call(this);
		this.name = "YAMLException";
		this.reason = reason;
		this.mark = mark;
		this.message = (this.reason || "(unknown reason)") + (this.mark ? " " + this.mark.toString() : "");
		if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
		else this.stack = (/* @__PURE__ */ new Error()).stack || "";
	}
	YAMLException.prototype = Object.create(Error.prototype);
	YAMLException.prototype.constructor = YAMLException;
	YAMLException.prototype.toString = function toString(compact) {
		var result = this.name + ": ";
		result += this.reason || "(unknown reason)";
		if (!compact && this.mark) result += " " + this.mark.toString();
		return result;
	};
	module.exports = YAMLException;
}));
// node_modules/js-yaml/lib/js-yaml/mark.js
var require_mark = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var common = require_common();
	function Mark(name, buffer, position, line, column) {
		this.name = name;
		this.buffer = buffer;
		this.position = position;
		this.line = line;
		this.column = column;
	}
	Mark.prototype.getSnippet = function getSnippet(indent, maxLength) {
		var head, start, tail, end, snippet;
		if (!this.buffer) return null;
		indent = indent || 4;
		maxLength = maxLength || 75;
		head = "";
		start = this.position;
		while (start > 0 && "\0\r\n\u2028\u2029".indexOf(this.buffer.charAt(start - 1)) === -1) {
			start -= 1;
			if (this.position - start > maxLength / 2 - 1) {
				head = " ... ";
				start += 5;
				break;
			}
		}
		tail = "";
		end = this.position;
		while (end < this.buffer.length && "\0\r\n\u2028\u2029".indexOf(this.buffer.charAt(end)) === -1) {
			end += 1;
			if (end - this.position > maxLength / 2 - 1) {
				tail = " ... ";
				end -= 5;
				break;
			}
		}
		snippet = this.buffer.slice(start, end);
		return common.repeat(" ", indent) + head + snippet + tail + "\n" + common.repeat(" ", indent + this.position - start + head.length) + "^";
	};
	Mark.prototype.toString = function toString(compact) {
		var snippet, where = "";
		if (this.name) where += "in \"" + this.name + "\" ";
		where += "at line " + (this.line + 1) + ", column " + (this.column + 1);
		if (!compact) {
			snippet = this.getSnippet();
			if (snippet) where += ":\n" + snippet;
		}
		return where;
	};
	module.exports = Mark;
}));
// node_modules/js-yaml/lib/js-yaml/type.js
var require_type = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var YAMLException = require_exception();
	var TYPE_CONSTRUCTOR_OPTIONS = [
		"kind",
		"resolve",
		"construct",
		"instanceOf",
		"predicate",
		"represent",
		"defaultStyle",
		"styleAliases"
	];
	var YAML_NODE_KINDS = [
		"scalar",
		"sequence",
		"mapping"
	];
	function compileStyleAliases(map) {
		var result = {};
		if (map !== null) Object.keys(map).forEach(function(style) {
			map[style].forEach(function(alias) {
				result[String(alias)] = style;
			});
		});
		return result;
	}
	function Type(tag, options) {
		options = options || {};
		Object.keys(options).forEach(function(name) {
			if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) throw new YAMLException("Unknown option \"" + name + "\" is met in definition of \"" + tag + "\" YAML type.");
		});
		this.tag = tag;
		this.kind = options["kind"] || null;
		this.resolve = options["resolve"] || function() {
			return true;
		};
		this.construct = options["construct"] || function(data) {
			return data;
		};
		this.instanceOf = options["instanceOf"] || null;
		this.predicate = options["predicate"] || null;
		this.represent = options["represent"] || null;
		this.defaultStyle = options["defaultStyle"] || null;
		this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
		if (YAML_NODE_KINDS.indexOf(this.kind) === -1) throw new YAMLException("Unknown kind \"" + this.kind + "\" is specified for \"" + tag + "\" YAML type.");
	}
	module.exports = Type;
}));
// node_modules/js-yaml/lib/js-yaml/schema.js
var require_schema = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var common = require_common();
	var YAMLException = require_exception();
	var Type = require_type();
	function compileList(schema, name, result) {
		var exclude = [];
		schema.include.forEach(function(includedSchema) {
			result = compileList(includedSchema, name, result);
		});
		schema[name].forEach(function(currentType) {
			result.forEach(function(previousType, previousIndex) {
				if (previousType.tag === currentType.tag && previousType.kind === currentType.kind) exclude.push(previousIndex);
			});
			result.push(currentType);
		});
		return result.filter(function(type, index) {
			return exclude.indexOf(index) === -1;
		});
	}
	function compileMap() {
		var result = {
			scalar: {},
			sequence: {},
			mapping: {},
			fallback: {}
		}, index, length;
		function collectType(type) {
			result[type.kind][type.tag] = result["fallback"][type.tag] = type;
		}
		for (index = 0, length = arguments.length; index < length; index += 1) arguments[index].forEach(collectType);
		return result;
	}
	function Schema(definition) {
		this.include = definition.include || [];
		this.implicit = definition.implicit || [];
		this.explicit = definition.explicit || [];
		this.implicit.forEach(function(type) {
			if (type.loadKind && type.loadKind !== "scalar") throw new YAMLException("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
		});
		this.compiledImplicit = compileList(this, "implicit", []);
		this.compiledExplicit = compileList(this, "explicit", []);
		this.compiledTypeMap = compileMap(this.compiledImplicit, this.compiledExplicit);
	}
	Schema.DEFAULT = null;
	Schema.create = function createSchema() {
		var schemas, types;
		switch (arguments.length) {
			case 1:
				schemas = Schema.DEFAULT;
				types = arguments[0];
				break;
			case 2:
				schemas = arguments[0];
				types = arguments[1];
				break;
			default: throw new YAMLException("Wrong number of arguments for Schema.create function");
		}
		schemas = common.toArray(schemas);
		types = common.toArray(types);
		if (!schemas.every(function(schema) {
			return schema instanceof Schema;
		})) throw new YAMLException("Specified list of super schemas (or a single Schema object) contains a non-Schema object.");
		if (!types.every(function(type) {
			return type instanceof Type;
		})) throw new YAMLException("Specified list of YAML types (or a single Type object) contains a non-Type object.");
		return new Schema({
			include: schemas,
			explicit: types
		});
	};
	module.exports = Schema;
}));
// node_modules/js-yaml/lib/js-yaml/type/str.js
var require_str = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = new (require_type())("tag:yaml.org,2002:str", {
		kind: "scalar",
		construct: function(data) {
			return data !== null ? data : "";
		}
	});
}));
// node_modules/js-yaml/lib/js-yaml/type/seq.js
var require_seq = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = new (require_type())("tag:yaml.org,2002:seq", {
		kind: "sequence",
		construct: function(data) {
			return data !== null ? data : [];
		}
	});
}));
// node_modules/js-yaml/lib/js-yaml/type/map.js
var require_map = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = new (require_type())("tag:yaml.org,2002:map", {
		kind: "mapping",
		construct: function(data) {
			return data !== null ? data : {};
		}
	});
}));
// node_modules/js-yaml/lib/js-yaml/schema/failsafe.js
var require_failsafe = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = new (require_schema())({ explicit: [
		require_str(),
		require_seq(),
		require_map()
	] });
}));
// node_modules/js-yaml/lib/js-yaml/type/null.js
var require_null = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Type = require_type();
	function resolveYamlNull(data) {
		if (data === null) return true;
		var max = data.length;
		return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
	}
	function constructYamlNull() {
		return null;
	}
	function isNull(object) {
		return object === null;
	}
	module.exports = new Type("tag:yaml.org,2002:null", {
		kind: "scalar",
		resolve: resolveYamlNull,
		construct: constructYamlNull,
		predicate: isNull,
		represent: {
			canonical: function() {
				return "~";
			},
			lowercase: function() {
				return "null";
			},
			uppercase: function() {
				return "NULL";
			},
			camelcase: function() {
				return "Null";
			}
		},
		defaultStyle: "lowercase"
	});
}));
// node_modules/js-yaml/lib/js-yaml/type/bool.js
var require_bool = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Type = require_type();
	function resolveYamlBoolean(data) {
		if (data === null) return false;
		var max = data.length;
		return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
	}
	function constructYamlBoolean(data) {
		return data === "true" || data === "True" || data === "TRUE";
	}
	function isBoolean(object) {
		return Object.prototype.toString.call(object) === "[object Boolean]";
	}
	module.exports = new Type("tag:yaml.org,2002:bool", {
		kind: "scalar",
		resolve: resolveYamlBoolean,
		construct: constructYamlBoolean,
		predicate: isBoolean,
		represent: {
			lowercase: function(object) {
				return object ? "true" : "false";
			},
			uppercase: function(object) {
				return object ? "TRUE" : "FALSE";
			},
			camelcase: function(object) {
				return object ? "True" : "False";
			}
		},
		defaultStyle: "lowercase"
	});
}));
// node_modules/js-yaml/lib/js-yaml/type/int.js
var require_int = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var common = require_common();
	var Type = require_type();
	function isHexCode(c) {
		return 48 <= c && c <= 57 || 65 <= c && c <= 70 || 97 <= c && c <= 102;
	}
	function isOctCode(c) {
		return 48 <= c && c <= 55;
	}
	function isDecCode(c) {
		return 48 <= c && c <= 57;
	}
	function resolveYamlInteger(data) {
		if (data === null) return false;
		var max = data.length, index = 0, hasDigits = false, ch;
		if (!max) return false;
		ch = data[index];
		if (ch === "-" || ch === "+") ch = data[++index];
		if (ch === "0") {
			if (index + 1 === max) return true;
			ch = data[++index];
			if (ch === "b") {
				index++;
				for (; index < max; index++) {
					ch = data[index];
					if (ch === "_") continue;
					if (ch !== "0" && ch !== "1") return false;
					hasDigits = true;
				}
				return hasDigits && ch !== "_";
			}
			if (ch === "x") {
				index++;
				for (; index < max; index++) {
					ch = data[index];
					if (ch === "_") continue;
					if (!isHexCode(data.charCodeAt(index))) return false;
					hasDigits = true;
				}
				return hasDigits && ch !== "_";
			}
			for (; index < max; index++) {
				ch = data[index];
				if (ch === "_") continue;
				if (!isOctCode(data.charCodeAt(index))) return false;
				hasDigits = true;
			}
			return hasDigits && ch !== "_";
		}
		if (ch === "_") return false;
		for (; index < max; index++) {
			ch = data[index];
			if (ch === "_") continue;
			if (ch === ":") break;
			if (!isDecCode(data.charCodeAt(index))) return false;
			hasDigits = true;
		}
		if (!hasDigits || ch === "_") return false;
		if (ch !== ":") return true;
		return /^(:[0-5]?[0-9])+$/.test(data.slice(index));
	}
	function constructYamlInteger(data) {
		var value = data, sign = 1, ch, base, digits = [];
		if (value.indexOf("_") !== -1) value = value.replace(/_/g, "");
		ch = value[0];
		if (ch === "-" || ch === "+") {
			if (ch === "-") sign = -1;
			value = value.slice(1);
			ch = value[0];
		}
		if (value === "0") return 0;
		if (ch === "0") {
			if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
			if (value[1] === "x") return sign * parseInt(value, 16);
			return sign * parseInt(value, 8);
		}
		if (value.indexOf(":") !== -1) {
			value.split(":").forEach(function(v) {
				digits.unshift(parseInt(v, 10));
			});
			value = 0;
			base = 1;
			digits.forEach(function(d) {
				value += d * base;
				base *= 60;
			});
			return sign * value;
		}
		return sign * parseInt(value, 10);
	}
	function isInteger(object) {
		return Object.prototype.toString.call(object) === "[object Number]" && object % 1 === 0 && !common.isNegativeZero(object);
	}
	module.exports = new Type("tag:yaml.org,2002:int", {
		kind: "scalar",
		resolve: resolveYamlInteger,
		construct: constructYamlInteger,
		predicate: isInteger,
		represent: {
			binary: function(obj) {
				return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
			},
			octal: function(obj) {
				return obj >= 0 ? "0" + obj.toString(8) : "-0" + obj.toString(8).slice(1);
			},
			decimal: function(obj) {
				return obj.toString(10);
			},
			hexadecimal: function(obj) {
				return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
			}
		},
		defaultStyle: "decimal",
		styleAliases: {
			binary: [2, "bin"],
			octal: [8, "oct"],
			decimal: [10, "dec"],
			hexadecimal: [16, "hex"]
		}
	});
}));
// node_modules/js-yaml/lib/js-yaml/type/float.js
var require_float = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var common = require_common();
	var Type = require_type();
	var YAML_FLOAT_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?(?:0|[1-9][0-9_]*)(?:\\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9_]+(?:[eE][-+]?[0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\\.[0-9_]*|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
	function resolveYamlFloat(data) {
		if (data === null) return false;
		if (!YAML_FLOAT_PATTERN.test(data) || data[data.length - 1] === "_") return false;
		return true;
	}
	function constructYamlFloat(data) {
		var value = data.replace(/_/g, "").toLowerCase(), sign = value[0] === "-" ? -1 : 1, base, digits = [];
		if ("+-".indexOf(value[0]) >= 0) value = value.slice(1);
		if (value === ".inf") return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
		else if (value === ".nan") return NaN;
		else if (value.indexOf(":") >= 0) {
			value.split(":").forEach(function(v) {
				digits.unshift(parseFloat(v, 10));
			});
			value = 0;
			base = 1;
			digits.forEach(function(d) {
				value += d * base;
				base *= 60;
			});
			return sign * value;
		}
		return sign * parseFloat(value, 10);
	}
	var SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
	function representYamlFloat(object, style) {
		var res;
		if (isNaN(object)) switch (style) {
			case "lowercase": return ".nan";
			case "uppercase": return ".NAN";
			case "camelcase": return ".NaN";
		}
		else if (Number.POSITIVE_INFINITY === object) switch (style) {
			case "lowercase": return ".inf";
			case "uppercase": return ".INF";
			case "camelcase": return ".Inf";
		}
		else if (Number.NEGATIVE_INFINITY === object) switch (style) {
			case "lowercase": return "-.inf";
			case "uppercase": return "-.INF";
			case "camelcase": return "-.Inf";
		}
		else if (common.isNegativeZero(object)) return "-0.0";
		res = object.toString(10);
		return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
	}
	function isFloat(object) {
		return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common.isNegativeZero(object));
	}
	module.exports = new Type("tag:yaml.org,2002:float", {
		kind: "scalar",
		resolve: resolveYamlFloat,
		construct: constructYamlFloat,
		predicate: isFloat,
		represent: representYamlFloat,
		defaultStyle: "lowercase"
	});
}));
// node_modules/js-yaml/lib/js-yaml/schema/json.js
var require_json = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = new (require_schema())({
		include: [require_failsafe()],
		implicit: [
			require_null(),
			require_bool(),
			require_int(),
			require_float()
		]
	});
}));
// node_modules/js-yaml/lib/js-yaml/schema/core.js
var require_core = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = new (require_schema())({ include: [require_json()] });
}));
// node_modules/js-yaml/lib/js-yaml/type/timestamp.js
var require_timestamp = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Type = require_type();
	var YAML_DATE_REGEXP = /* @__PURE__ */ new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$");
	var YAML_TIMESTAMP_REGEXP = /* @__PURE__ */ new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$");
	function resolveYamlTimestamp(data) {
		if (data === null) return false;
		if (YAML_DATE_REGEXP.exec(data) !== null) return true;
		if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true;
		return false;
	}
	function constructYamlTimestamp(data) {
		var match, year, month, day, hour, minute, second, fraction = 0, delta = null, tz_hour, tz_minute, date;
		match = YAML_DATE_REGEXP.exec(data);
		if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data);
		if (match === null) throw new Error("Date resolve error");
		year = +match[1];
		month = +match[2] - 1;
		day = +match[3];
		if (!match[4]) return new Date(Date.UTC(year, month, day));
		hour = +match[4];
		minute = +match[5];
		second = +match[6];
		if (match[7]) {
			fraction = match[7].slice(0, 3);
			while (fraction.length < 3) fraction += "0";
			fraction = +fraction;
		}
		if (match[9]) {
			tz_hour = +match[10];
			tz_minute = +(match[11] || 0);
			delta = (tz_hour * 60 + tz_minute) * 6e4;
			if (match[9] === "-") delta = -delta;
		}
		date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
		if (delta) date.setTime(date.getTime() - delta);
		return date;
	}
	function representYamlTimestamp(object) {
		return object.toISOString();
	}
	module.exports = new Type("tag:yaml.org,2002:timestamp", {
		kind: "scalar",
		resolve: resolveYamlTimestamp,
		construct: constructYamlTimestamp,
		instanceOf: Date,
		represent: representYamlTimestamp
	});
}));
// node_modules/js-yaml/lib/js-yaml/type/merge.js
var require_merge = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Type = require_type();
	function resolveYamlMerge(data) {
		return data === "<<" || data === null;
	}
	module.exports = new Type("tag:yaml.org,2002:merge", {
		kind: "scalar",
		resolve: resolveYamlMerge
	});
}));
// node_modules/js-yaml/lib/js-yaml/type/binary.js
var require_binary = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var NodeBuffer;
	try {
		NodeBuffer = __require("buffer").Buffer;
	} catch (__) {}
	var Type = require_type();
	var BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
	function resolveYamlBinary(data) {
		if (data === null) return false;
		var code, idx, bitlen = 0, max = data.length, map = BASE64_MAP;
		for (idx = 0; idx < max; idx++) {
			code = map.indexOf(data.charAt(idx));
			if (code > 64) continue;
			if (code < 0) return false;
			bitlen += 6;
		}
		return bitlen % 8 === 0;
	}
	function constructYamlBinary(data) {
		var idx, tailbits, input = data.replace(/[\r\n=]/g, ""), max = input.length, map = BASE64_MAP, bits = 0, result = [];
		for (idx = 0; idx < max; idx++) {
			if (idx % 4 === 0 && idx) {
				result.push(bits >> 16 & 255);
				result.push(bits >> 8 & 255);
				result.push(bits & 255);
			}
			bits = bits << 6 | map.indexOf(input.charAt(idx));
		}
		tailbits = max % 4 * 6;
		if (tailbits === 0) {
			result.push(bits >> 16 & 255);
			result.push(bits >> 8 & 255);
			result.push(bits & 255);
		} else if (tailbits === 18) {
			result.push(bits >> 10 & 255);
			result.push(bits >> 2 & 255);
		} else if (tailbits === 12) result.push(bits >> 4 & 255);
		if (NodeBuffer) return NodeBuffer.from ? NodeBuffer.from(result) : new NodeBuffer(result);
		return result;
	}
	function representYamlBinary(object) {
		var result = "", bits = 0, idx, tail, max = object.length, map = BASE64_MAP;
		for (idx = 0; idx < max; idx++) {
			if (idx % 3 === 0 && idx) {
				result += map[bits >> 18 & 63];
				result += map[bits >> 12 & 63];
				result += map[bits >> 6 & 63];
				result += map[bits & 63];
			}
			bits = (bits << 8) + object[idx];
		}
		tail = max % 3;
		if (tail === 0) {
			result += map[bits >> 18 & 63];
			result += map[bits >> 12 & 63];
			result += map[bits >> 6 & 63];
			result += map[bits & 63];
		} else if (tail === 2) {
			result += map[bits >> 10 & 63];
			result += map[bits >> 4 & 63];
			result += map[bits << 2 & 63];
			result += map[64];
		} else if (tail === 1) {
			result += map[bits >> 2 & 63];
			result += map[bits << 4 & 63];
			result += map[64];
			result += map[64];
		}
		return result;
	}
	function isBinary(object) {
		return NodeBuffer && NodeBuffer.isBuffer(object);
	}
	module.exports = new Type("tag:yaml.org,2002:binary", {
		kind: "scalar",
		resolve: resolveYamlBinary,
		construct: constructYamlBinary,
		predicate: isBinary,
		represent: representYamlBinary
	});
}));
// node_modules/js-yaml/lib/js-yaml/type/omap.js
var require_omap = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Type = require_type();
	var _hasOwnProperty = Object.prototype.hasOwnProperty;
	var _toString = Object.prototype.toString;
	function resolveYamlOmap(data) {
		if (data === null) return true;
		var objectKeys = {}, index, length, pair, pairKey, pairHasKey, object = data;
		for (index = 0, length = object.length; index < length; index += 1) {
			pair = object[index];
			pairHasKey = false;
			if (_toString.call(pair) !== "[object Object]") return false;
			for (pairKey in pair) if (_hasOwnProperty.call(pair, pairKey)) {
				if (!pairHasKey) pairHasKey = true;
				else return false;
			}
			if (!pairHasKey) return false;
			if (_hasOwnProperty.call(objectKeys, pairKey)) return false;
			Object.defineProperty(objectKeys, pairKey, { value: true });
		}
		return true;
	}
	function constructYamlOmap(data) {
		return data !== null ? data : [];
	}
	module.exports = new Type("tag:yaml.org,2002:omap", {
		kind: "sequence",
		resolve: resolveYamlOmap,
		construct: constructYamlOmap
	});
}));
// node_modules/js-yaml/lib/js-yaml/type/pairs.js
var require_pairs = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Type = require_type();
	var _toString = Object.prototype.toString;
	function resolveYamlPairs(data) {
		if (data === null) return true;
		var index, length, pair, keys, result, object = data;
		result = new Array(object.length);
		for (index = 0, length = object.length; index < length; index += 1) {
			pair = object[index];
			if (_toString.call(pair) !== "[object Object]") return false;
			keys = Object.keys(pair);
			if (keys.length !== 1) return false;
			result[index] = [keys[0], pair[keys[0]]];
		}
		return true;
	}
	function constructYamlPairs(data) {
		if (data === null) return [];
		var index, length, pair, keys, result, object = data;
		result = new Array(object.length);
		for (index = 0, length = object.length; index < length; index += 1) {
			pair = object[index];
			keys = Object.keys(pair);
			result[index] = [keys[0], pair[keys[0]]];
		}
		return result;
	}
	module.exports = new Type("tag:yaml.org,2002:pairs", {
		kind: "sequence",
		resolve: resolveYamlPairs,
		construct: constructYamlPairs
	});
}));
// node_modules/js-yaml/lib/js-yaml/type/set.js
var require_set = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Type = require_type();
	var _hasOwnProperty = Object.prototype.hasOwnProperty;
	function resolveYamlSet(data) {
		if (data === null) return true;
		var key, object = data;
		for (key in object) if (_hasOwnProperty.call(object, key)) {
			if (object[key] !== null) return false;
		}
		return true;
	}
	function constructYamlSet(data) {
		return data !== null ? data : {};
	}
	module.exports = new Type("tag:yaml.org,2002:set", {
		kind: "mapping",
		resolve: resolveYamlSet,
		construct: constructYamlSet
	});
}));
// node_modules/js-yaml/lib/js-yaml/schema/default_safe.js
var require_default_safe = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = new (require_schema())({
		include: [require_core()],
		implicit: [require_timestamp(), require_merge()],
		explicit: [
			require_binary(),
			require_omap(),
			require_pairs(),
			require_set()
		]
	});
}));
// node_modules/js-yaml/lib/js-yaml/type/js/undefined.js
var require_undefined = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Type = require_type();
	function resolveJavascriptUndefined() {
		return true;
	}
	function constructJavascriptUndefined() {}
	function representJavascriptUndefined() {
		return "";
	}
	function isUndefined(object) {
		return typeof object === "undefined";
	}
	module.exports = new Type("tag:yaml.org,2002:js/undefined", {
		kind: "scalar",
		resolve: resolveJavascriptUndefined,
		construct: constructJavascriptUndefined,
		predicate: isUndefined,
		represent: representJavascriptUndefined
	});
}));
// node_modules/js-yaml/lib/js-yaml/type/js/regexp.js
var require_regexp = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Type = require_type();
	function resolveJavascriptRegExp(data) {
		if (data === null) return false;
		if (data.length === 0) return false;
		var regexp = data, tail = /\/([gim]*)$/.exec(data), modifiers = "";
		if (regexp[0] === "/") {
			if (tail) modifiers = tail[1];
			if (modifiers.length > 3) return false;
			if (regexp[regexp.length - modifiers.length - 1] !== "/") return false;
		}
		return true;
	}
	function constructJavascriptRegExp(data) {
		var regexp = data, tail = /\/([gim]*)$/.exec(data), modifiers = "";
		if (regexp[0] === "/") {
			if (tail) modifiers = tail[1];
			regexp = regexp.slice(1, regexp.length - modifiers.length - 1);
		}
		return new RegExp(regexp, modifiers);
	}
	function representJavascriptRegExp(object) {
		var result = "/" + object.source + "/";
		if (object.global) result += "g";
		if (object.multiline) result += "m";
		if (object.ignoreCase) result += "i";
		return result;
	}
	function isRegExp(object) {
		return Object.prototype.toString.call(object) === "[object RegExp]";
	}
	module.exports = new Type("tag:yaml.org,2002:js/regexp", {
		kind: "scalar",
		resolve: resolveJavascriptRegExp,
		construct: constructJavascriptRegExp,
		predicate: isRegExp,
		represent: representJavascriptRegExp
	});
}));
// node_modules/esprima/dist/esprima.js
var require_esprima = /* @__PURE__ */ __commonJSMin(((exports, module, this$1) => {
	(function webpackUniversalModuleDefinition(root, factory) {
		/* istanbul ignore next */
		if (typeof exports === "object" && typeof module === "object") module.exports = factory();
		else if (typeof define === "function" && define.amd) define([], factory);
		else if (typeof exports === "object") exports["esprima"] = factory();
		else root["esprima"] = factory();
	})(this$1, function() {
		return (function(modules) {
			var installedModules = {};
			function __webpack_require__(moduleId) {
				/* istanbul ignore if */
				if (installedModules[moduleId]) return installedModules[moduleId].exports;
				var module = installedModules[moduleId] = {
					exports: {},
					id: moduleId,
					loaded: false
				};
				modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
				module.loaded = true;
				return module.exports;
			}
			__webpack_require__.m = modules;
			__webpack_require__.c = installedModules;
			__webpack_require__.p = "";
			return __webpack_require__(0);
		})([
			function(module, exports, __webpack_require__) {
				"use strict";
				Object.defineProperty(exports, "__esModule", { value: true });
				var comment_handler_1 = __webpack_require__(1);
				var jsx_parser_1 = __webpack_require__(3);
				var parser_1 = __webpack_require__(8);
				var tokenizer_1 = __webpack_require__(15);
				function parse(code, options, delegate) {
					var commentHandler = null;
					var proxyDelegate = function(node, metadata) {
						if (delegate) delegate(node, metadata);
						if (commentHandler) commentHandler.visit(node, metadata);
					};
					var parserDelegate = typeof delegate === "function" ? proxyDelegate : null;
					var collectComment = false;
					if (options) {
						collectComment = typeof options.comment === "boolean" && options.comment;
						var attachComment = typeof options.attachComment === "boolean" && options.attachComment;
						if (collectComment || attachComment) {
							commentHandler = new comment_handler_1.CommentHandler();
							commentHandler.attach = attachComment;
							options.comment = true;
							parserDelegate = proxyDelegate;
						}
					}
					var isModule = false;
					if (options && typeof options.sourceType === "string") isModule = options.sourceType === "module";
					var parser;
					if (options && typeof options.jsx === "boolean" && options.jsx) parser = new jsx_parser_1.JSXParser(code, options, parserDelegate);
					else parser = new parser_1.Parser(code, options, parserDelegate);
					var ast = isModule ? parser.parseModule() : parser.parseScript();
					if (collectComment && commentHandler) ast.comments = commentHandler.comments;
					if (parser.config.tokens) ast.tokens = parser.tokens;
					if (parser.config.tolerant) ast.errors = parser.errorHandler.errors;
					return ast;
				}
				exports.parse = parse;
				function parseModule(code, options, delegate) {
					var parsingOptions = options || {};
					parsingOptions.sourceType = "module";
					return parse(code, parsingOptions, delegate);
				}
				exports.parseModule = parseModule;
				function parseScript(code, options, delegate) {
					var parsingOptions = options || {};
					parsingOptions.sourceType = "script";
					return parse(code, parsingOptions, delegate);
				}
				exports.parseScript = parseScript;
				function tokenize(code, options, delegate) {
					var tokenizer = new tokenizer_1.Tokenizer(code, options);
					var tokens = [];
					try {
						while (true) {
							var token = tokenizer.getNextToken();
							if (!token) break;
							if (delegate) token = delegate(token);
							tokens.push(token);
						}
					} catch (e) {
						tokenizer.errorHandler.tolerate(e);
					}
					if (tokenizer.errorHandler.tolerant) tokens.errors = tokenizer.errors();
					return tokens;
				}
				exports.tokenize = tokenize;
				exports.Syntax = __webpack_require__(2).Syntax;
				exports.version = "4.0.1";
			},
			function(module, exports, __webpack_require__) {
				"use strict";
				Object.defineProperty(exports, "__esModule", { value: true });
				var syntax_1 = __webpack_require__(2);
				exports.CommentHandler = function() {
					function CommentHandler() {
						this.attach = false;
						this.comments = [];
						this.stack = [];
						this.leading = [];
						this.trailing = [];
					}
					CommentHandler.prototype.insertInnerComments = function(node, metadata) {
						if (node.type === syntax_1.Syntax.BlockStatement && node.body.length === 0) {
							var innerComments = [];
							for (var i = this.leading.length - 1; i >= 0; --i) {
								var entry = this.leading[i];
								if (metadata.end.offset >= entry.start) {
									innerComments.unshift(entry.comment);
									this.leading.splice(i, 1);
									this.trailing.splice(i, 1);
								}
							}
							if (innerComments.length) node.innerComments = innerComments;
						}
					};
					CommentHandler.prototype.findTrailingComments = function(metadata) {
						var trailingComments = [];
						if (this.trailing.length > 0) {
							for (var i = this.trailing.length - 1; i >= 0; --i) {
								var entry_1 = this.trailing[i];
								if (entry_1.start >= metadata.end.offset) trailingComments.unshift(entry_1.comment);
							}
							this.trailing.length = 0;
							return trailingComments;
						}
						var entry = this.stack[this.stack.length - 1];
						if (entry && entry.node.trailingComments) {
							var firstComment = entry.node.trailingComments[0];
							if (firstComment && firstComment.range[0] >= metadata.end.offset) {
								trailingComments = entry.node.trailingComments;
								delete entry.node.trailingComments;
							}
						}
						return trailingComments;
					};
					CommentHandler.prototype.findLeadingComments = function(metadata) {
						var leadingComments = [];
						var target;
						while (this.stack.length > 0) {
							var entry = this.stack[this.stack.length - 1];
							if (entry && entry.start >= metadata.start.offset) {
								target = entry.node;
								this.stack.pop();
							} else break;
						}
						if (target) {
							for (var i = (target.leadingComments ? target.leadingComments.length : 0) - 1; i >= 0; --i) {
								var comment = target.leadingComments[i];
								if (comment.range[1] <= metadata.start.offset) {
									leadingComments.unshift(comment);
									target.leadingComments.splice(i, 1);
								}
							}
							if (target.leadingComments && target.leadingComments.length === 0) delete target.leadingComments;
							return leadingComments;
						}
						for (var i = this.leading.length - 1; i >= 0; --i) {
							var entry = this.leading[i];
							if (entry.start <= metadata.start.offset) {
								leadingComments.unshift(entry.comment);
								this.leading.splice(i, 1);
							}
						}
						return leadingComments;
					};
					CommentHandler.prototype.visitNode = function(node, metadata) {
						if (node.type === syntax_1.Syntax.Program && node.body.length > 0) return;
						this.insertInnerComments(node, metadata);
						var trailingComments = this.findTrailingComments(metadata);
						var leadingComments = this.findLeadingComments(metadata);
						if (leadingComments.length > 0) node.leadingComments = leadingComments;
						if (trailingComments.length > 0) node.trailingComments = trailingComments;
						this.stack.push({
							node,
							start: metadata.start.offset
						});
					};
					CommentHandler.prototype.visitComment = function(node, metadata) {
						var type = node.type[0] === "L" ? "Line" : "Block";
						var comment = {
							type,
							value: node.value
						};
						if (node.range) comment.range = node.range;
						if (node.loc) comment.loc = node.loc;
						this.comments.push(comment);
						if (this.attach) {
							var entry = {
								comment: {
									type,
									value: node.value,
									range: [metadata.start.offset, metadata.end.offset]
								},
								start: metadata.start.offset
							};
							if (node.loc) entry.comment.loc = node.loc;
							node.type = type;
							this.leading.push(entry);
							this.trailing.push(entry);
						}
					};
					CommentHandler.prototype.visit = function(node, metadata) {
						if (node.type === "LineComment") this.visitComment(node, metadata);
						else if (node.type === "BlockComment") this.visitComment(node, metadata);
						else if (this.attach) this.visitNode(node, metadata);
					};
					return CommentHandler;
				}();
			},
			function(module, exports) {
				"use strict";
				Object.defineProperty(exports, "__esModule", { value: true });
				exports.Syntax = {
					AssignmentExpression: "AssignmentExpression",
					AssignmentPattern: "AssignmentPattern",
					ArrayExpression: "ArrayExpression",
					ArrayPattern: "ArrayPattern",
					ArrowFunctionExpression: "ArrowFunctionExpression",
					AwaitExpression: "AwaitExpression",
					BlockStatement: "BlockStatement",
					BinaryExpression: "BinaryExpression",
					BreakStatement: "BreakStatement",
					CallExpression: "CallExpression",
					CatchClause: "CatchClause",
					ClassBody: "ClassBody",
					ClassDeclaration: "ClassDeclaration",
					ClassExpression: "ClassExpression",
					ConditionalExpression: "ConditionalExpression",
					ContinueStatement: "ContinueStatement",
					DoWhileStatement: "DoWhileStatement",
					DebuggerStatement: "DebuggerStatement",
					EmptyStatement: "EmptyStatement",
					ExportAllDeclaration: "ExportAllDeclaration",
					ExportDefaultDeclaration: "ExportDefaultDeclaration",
					ExportNamedDeclaration: "ExportNamedDeclaration",
					ExportSpecifier: "ExportSpecifier",
					ExpressionStatement: "ExpressionStatement",
					ForStatement: "ForStatement",
					ForOfStatement: "ForOfStatement",
					ForInStatement: "ForInStatement",
					FunctionDeclaration: "FunctionDeclaration",
					FunctionExpression: "FunctionExpression",
					Identifier: "Identifier",
					IfStatement: "IfStatement",
					ImportDeclaration: "ImportDeclaration",
					ImportDefaultSpecifier: "ImportDefaultSpecifier",
					ImportNamespaceSpecifier: "ImportNamespaceSpecifier",
					ImportSpecifier: "ImportSpecifier",
					Literal: "Literal",
					LabeledStatement: "LabeledStatement",
					LogicalExpression: "LogicalExpression",
					MemberExpression: "MemberExpression",
					MetaProperty: "MetaProperty",
					MethodDefinition: "MethodDefinition",
					NewExpression: "NewExpression",
					ObjectExpression: "ObjectExpression",
					ObjectPattern: "ObjectPattern",
					Program: "Program",
					Property: "Property",
					RestElement: "RestElement",
					ReturnStatement: "ReturnStatement",
					SequenceExpression: "SequenceExpression",
					SpreadElement: "SpreadElement",
					Super: "Super",
					SwitchCase: "SwitchCase",
					SwitchStatement: "SwitchStatement",
					TaggedTemplateExpression: "TaggedTemplateExpression",
					TemplateElement: "TemplateElement",
					TemplateLiteral: "TemplateLiteral",
					ThisExpression: "ThisExpression",
					ThrowStatement: "ThrowStatement",
					TryStatement: "TryStatement",
					UnaryExpression: "UnaryExpression",
					UpdateExpression: "UpdateExpression",
					VariableDeclaration: "VariableDeclaration",
					VariableDeclarator: "VariableDeclarator",
					WhileStatement: "WhileStatement",
					WithStatement: "WithStatement",
					YieldExpression: "YieldExpression"
				};
			},
			function(module, exports, __webpack_require__) {
				"use strict";
				/* istanbul ignore next */
				var __extends = this && this.__extends || (function() {
					var extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d, b) {
						d.__proto__ = b;
					} || function(d, b) {
						for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
					};
					return function(d, b) {
						extendStatics(d, b);
						function __() {
							this.constructor = d;
						}
						d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
					};
				})();
				Object.defineProperty(exports, "__esModule", { value: true });
				var character_1 = __webpack_require__(4);
				var JSXNode = __webpack_require__(5);
				var jsx_syntax_1 = __webpack_require__(6);
				var Node = __webpack_require__(7);
				var parser_1 = __webpack_require__(8);
				var token_1 = __webpack_require__(13);
				var xhtml_entities_1 = __webpack_require__(14);
				token_1.TokenName[100] = "JSXIdentifier";
				token_1.TokenName[101] = "JSXText";
				function getQualifiedElementName(elementName) {
					var qualifiedName;
					switch (elementName.type) {
						case jsx_syntax_1.JSXSyntax.JSXIdentifier:
							qualifiedName = elementName.name;
							break;
						case jsx_syntax_1.JSXSyntax.JSXNamespacedName:
							var ns = elementName;
							qualifiedName = getQualifiedElementName(ns.namespace) + ":" + getQualifiedElementName(ns.name);
							break;
						case jsx_syntax_1.JSXSyntax.JSXMemberExpression:
							var expr = elementName;
							qualifiedName = getQualifiedElementName(expr.object) + "." + getQualifiedElementName(expr.property);
					}
					return qualifiedName;
				}
				exports.JSXParser = function(_super) {
					__extends(JSXParser, _super);
					function JSXParser(code, options, delegate) {
						return _super.call(this, code, options, delegate) || this;
					}
					JSXParser.prototype.parsePrimaryExpression = function() {
						return this.match("<") ? this.parseJSXRoot() : _super.prototype.parsePrimaryExpression.call(this);
					};
					JSXParser.prototype.startJSX = function() {
						this.scanner.index = this.startMarker.index;
						this.scanner.lineNumber = this.startMarker.line;
						this.scanner.lineStart = this.startMarker.index - this.startMarker.column;
					};
					JSXParser.prototype.finishJSX = function() {
						this.nextToken();
					};
					JSXParser.prototype.reenterJSX = function() {
						this.startJSX();
						this.expectJSX("}");
						if (this.config.tokens) this.tokens.pop();
					};
					JSXParser.prototype.createJSXNode = function() {
						this.collectComments();
						return {
							index: this.scanner.index,
							line: this.scanner.lineNumber,
							column: this.scanner.index - this.scanner.lineStart
						};
					};
					JSXParser.prototype.createJSXChildNode = function() {
						return {
							index: this.scanner.index,
							line: this.scanner.lineNumber,
							column: this.scanner.index - this.scanner.lineStart
						};
					};
					JSXParser.prototype.scanXHTMLEntity = function(quote) {
						var result = "&";
						var valid = true;
						var terminated = false;
						var numeric = false;
						var hex = false;
						while (!this.scanner.eof() && valid && !terminated) {
							var ch = this.scanner.source[this.scanner.index];
							if (ch === quote) break;
							terminated = ch === ";";
							result += ch;
							++this.scanner.index;
							if (!terminated) switch (result.length) {
								case 2:
									numeric = ch === "#";
									break;
								case 3:
									if (numeric) {
										hex = ch === "x";
										valid = hex || character_1.Character.isDecimalDigit(ch.charCodeAt(0));
										numeric = numeric && !hex;
									}
									break;
								default:
									valid = valid && !(numeric && !character_1.Character.isDecimalDigit(ch.charCodeAt(0)));
									valid = valid && !(hex && !character_1.Character.isHexDigit(ch.charCodeAt(0)));
							}
						}
						if (valid && terminated && result.length > 2) {
							var str = result.substr(1, result.length - 2);
							if (numeric && str.length > 1) result = String.fromCharCode(parseInt(str.substr(1), 10));
							else if (hex && str.length > 2) result = String.fromCharCode(parseInt("0" + str.substr(1), 16));
							else if (!numeric && !hex && xhtml_entities_1.XHTMLEntities[str]) result = xhtml_entities_1.XHTMLEntities[str];
						}
						return result;
					};
					JSXParser.prototype.lexJSX = function() {
						var cp = this.scanner.source.charCodeAt(this.scanner.index);
						if (cp === 60 || cp === 62 || cp === 47 || cp === 58 || cp === 61 || cp === 123 || cp === 125) {
							var value = this.scanner.source[this.scanner.index++];
							return {
								type: 7,
								value,
								lineNumber: this.scanner.lineNumber,
								lineStart: this.scanner.lineStart,
								start: this.scanner.index - 1,
								end: this.scanner.index
							};
						}
						if (cp === 34 || cp === 39) {
							var start = this.scanner.index;
							var quote = this.scanner.source[this.scanner.index++];
							var str = "";
							while (!this.scanner.eof()) {
								var ch = this.scanner.source[this.scanner.index++];
								if (ch === quote) break;
								else if (ch === "&") str += this.scanXHTMLEntity(quote);
								else str += ch;
							}
							return {
								type: 8,
								value: str,
								lineNumber: this.scanner.lineNumber,
								lineStart: this.scanner.lineStart,
								start,
								end: this.scanner.index
							};
						}
						if (cp === 46) {
							var n1 = this.scanner.source.charCodeAt(this.scanner.index + 1);
							var n2 = this.scanner.source.charCodeAt(this.scanner.index + 2);
							var value = n1 === 46 && n2 === 46 ? "..." : ".";
							var start = this.scanner.index;
							this.scanner.index += value.length;
							return {
								type: 7,
								value,
								lineNumber: this.scanner.lineNumber,
								lineStart: this.scanner.lineStart,
								start,
								end: this.scanner.index
							};
						}
						if (cp === 96) return {
							type: 10,
							value: "",
							lineNumber: this.scanner.lineNumber,
							lineStart: this.scanner.lineStart,
							start: this.scanner.index,
							end: this.scanner.index
						};
						if (character_1.Character.isIdentifierStart(cp) && cp !== 92) {
							var start = this.scanner.index;
							++this.scanner.index;
							while (!this.scanner.eof()) {
								var ch = this.scanner.source.charCodeAt(this.scanner.index);
								if (character_1.Character.isIdentifierPart(ch) && ch !== 92) ++this.scanner.index;
								else if (ch === 45) ++this.scanner.index;
								else break;
							}
							return {
								type: 100,
								value: this.scanner.source.slice(start, this.scanner.index),
								lineNumber: this.scanner.lineNumber,
								lineStart: this.scanner.lineStart,
								start,
								end: this.scanner.index
							};
						}
						return this.scanner.lex();
					};
					JSXParser.prototype.nextJSXToken = function() {
						this.collectComments();
						this.startMarker.index = this.scanner.index;
						this.startMarker.line = this.scanner.lineNumber;
						this.startMarker.column = this.scanner.index - this.scanner.lineStart;
						var token = this.lexJSX();
						this.lastMarker.index = this.scanner.index;
						this.lastMarker.line = this.scanner.lineNumber;
						this.lastMarker.column = this.scanner.index - this.scanner.lineStart;
						if (this.config.tokens) this.tokens.push(this.convertToken(token));
						return token;
					};
					JSXParser.prototype.nextJSXText = function() {
						this.startMarker.index = this.scanner.index;
						this.startMarker.line = this.scanner.lineNumber;
						this.startMarker.column = this.scanner.index - this.scanner.lineStart;
						var start = this.scanner.index;
						var text = "";
						while (!this.scanner.eof()) {
							var ch = this.scanner.source[this.scanner.index];
							if (ch === "{" || ch === "<") break;
							++this.scanner.index;
							text += ch;
							if (character_1.Character.isLineTerminator(ch.charCodeAt(0))) {
								++this.scanner.lineNumber;
								if (ch === "\r" && this.scanner.source[this.scanner.index] === "\n") ++this.scanner.index;
								this.scanner.lineStart = this.scanner.index;
							}
						}
						this.lastMarker.index = this.scanner.index;
						this.lastMarker.line = this.scanner.lineNumber;
						this.lastMarker.column = this.scanner.index - this.scanner.lineStart;
						var token = {
							type: 101,
							value: text,
							lineNumber: this.scanner.lineNumber,
							lineStart: this.scanner.lineStart,
							start,
							end: this.scanner.index
						};
						if (text.length > 0 && this.config.tokens) this.tokens.push(this.convertToken(token));
						return token;
					};
					JSXParser.prototype.peekJSXToken = function() {
						var state = this.scanner.saveState();
						this.scanner.scanComments();
						var next = this.lexJSX();
						this.scanner.restoreState(state);
						return next;
					};
					JSXParser.prototype.expectJSX = function(value) {
						var token = this.nextJSXToken();
						if (token.type !== 7 || token.value !== value) this.throwUnexpectedToken(token);
					};
					JSXParser.prototype.matchJSX = function(value) {
						var next = this.peekJSXToken();
						return next.type === 7 && next.value === value;
					};
					JSXParser.prototype.parseJSXIdentifier = function() {
						var node = this.createJSXNode();
						var token = this.nextJSXToken();
						if (token.type !== 100) this.throwUnexpectedToken(token);
						return this.finalize(node, new JSXNode.JSXIdentifier(token.value));
					};
					JSXParser.prototype.parseJSXElementName = function() {
						var node = this.createJSXNode();
						var elementName = this.parseJSXIdentifier();
						if (this.matchJSX(":")) {
							var namespace = elementName;
							this.expectJSX(":");
							var name_1 = this.parseJSXIdentifier();
							elementName = this.finalize(node, new JSXNode.JSXNamespacedName(namespace, name_1));
						} else if (this.matchJSX(".")) while (this.matchJSX(".")) {
							var object = elementName;
							this.expectJSX(".");
							var property = this.parseJSXIdentifier();
							elementName = this.finalize(node, new JSXNode.JSXMemberExpression(object, property));
						}
						return elementName;
					};
					JSXParser.prototype.parseJSXAttributeName = function() {
						var node = this.createJSXNode();
						var attributeName;
						var identifier = this.parseJSXIdentifier();
						if (this.matchJSX(":")) {
							var namespace = identifier;
							this.expectJSX(":");
							var name_2 = this.parseJSXIdentifier();
							attributeName = this.finalize(node, new JSXNode.JSXNamespacedName(namespace, name_2));
						} else attributeName = identifier;
						return attributeName;
					};
					JSXParser.prototype.parseJSXStringLiteralAttribute = function() {
						var node = this.createJSXNode();
						var token = this.nextJSXToken();
						if (token.type !== 8) this.throwUnexpectedToken(token);
						var raw = this.getTokenRaw(token);
						return this.finalize(node, new Node.Literal(token.value, raw));
					};
					JSXParser.prototype.parseJSXExpressionAttribute = function() {
						var node = this.createJSXNode();
						this.expectJSX("{");
						this.finishJSX();
						if (this.match("}")) this.tolerateError("JSX attributes must only be assigned a non-empty expression");
						var expression = this.parseAssignmentExpression();
						this.reenterJSX();
						return this.finalize(node, new JSXNode.JSXExpressionContainer(expression));
					};
					JSXParser.prototype.parseJSXAttributeValue = function() {
						return this.matchJSX("{") ? this.parseJSXExpressionAttribute() : this.matchJSX("<") ? this.parseJSXElement() : this.parseJSXStringLiteralAttribute();
					};
					JSXParser.prototype.parseJSXNameValueAttribute = function() {
						var node = this.createJSXNode();
						var name = this.parseJSXAttributeName();
						var value = null;
						if (this.matchJSX("=")) {
							this.expectJSX("=");
							value = this.parseJSXAttributeValue();
						}
						return this.finalize(node, new JSXNode.JSXAttribute(name, value));
					};
					JSXParser.prototype.parseJSXSpreadAttribute = function() {
						var node = this.createJSXNode();
						this.expectJSX("{");
						this.expectJSX("...");
						this.finishJSX();
						var argument = this.parseAssignmentExpression();
						this.reenterJSX();
						return this.finalize(node, new JSXNode.JSXSpreadAttribute(argument));
					};
					JSXParser.prototype.parseJSXAttributes = function() {
						var attributes = [];
						while (!this.matchJSX("/") && !this.matchJSX(">")) {
							var attribute = this.matchJSX("{") ? this.parseJSXSpreadAttribute() : this.parseJSXNameValueAttribute();
							attributes.push(attribute);
						}
						return attributes;
					};
					JSXParser.prototype.parseJSXOpeningElement = function() {
						var node = this.createJSXNode();
						this.expectJSX("<");
						var name = this.parseJSXElementName();
						var attributes = this.parseJSXAttributes();
						var selfClosing = this.matchJSX("/");
						if (selfClosing) this.expectJSX("/");
						this.expectJSX(">");
						return this.finalize(node, new JSXNode.JSXOpeningElement(name, selfClosing, attributes));
					};
					JSXParser.prototype.parseJSXBoundaryElement = function() {
						var node = this.createJSXNode();
						this.expectJSX("<");
						if (this.matchJSX("/")) {
							this.expectJSX("/");
							var name_3 = this.parseJSXElementName();
							this.expectJSX(">");
							return this.finalize(node, new JSXNode.JSXClosingElement(name_3));
						}
						var name = this.parseJSXElementName();
						var attributes = this.parseJSXAttributes();
						var selfClosing = this.matchJSX("/");
						if (selfClosing) this.expectJSX("/");
						this.expectJSX(">");
						return this.finalize(node, new JSXNode.JSXOpeningElement(name, selfClosing, attributes));
					};
					JSXParser.prototype.parseJSXEmptyExpression = function() {
						var node = this.createJSXChildNode();
						this.collectComments();
						this.lastMarker.index = this.scanner.index;
						this.lastMarker.line = this.scanner.lineNumber;
						this.lastMarker.column = this.scanner.index - this.scanner.lineStart;
						return this.finalize(node, new JSXNode.JSXEmptyExpression());
					};
					JSXParser.prototype.parseJSXExpressionContainer = function() {
						var node = this.createJSXNode();
						this.expectJSX("{");
						var expression;
						if (this.matchJSX("}")) {
							expression = this.parseJSXEmptyExpression();
							this.expectJSX("}");
						} else {
							this.finishJSX();
							expression = this.parseAssignmentExpression();
							this.reenterJSX();
						}
						return this.finalize(node, new JSXNode.JSXExpressionContainer(expression));
					};
					JSXParser.prototype.parseJSXChildren = function() {
						var children = [];
						while (!this.scanner.eof()) {
							var node = this.createJSXChildNode();
							var token = this.nextJSXText();
							if (token.start < token.end) {
								var raw = this.getTokenRaw(token);
								var child = this.finalize(node, new JSXNode.JSXText(token.value, raw));
								children.push(child);
							}
							if (this.scanner.source[this.scanner.index] === "{") {
								var container = this.parseJSXExpressionContainer();
								children.push(container);
							} else break;
						}
						return children;
					};
					JSXParser.prototype.parseComplexJSXElement = function(el) {
						var stack = [];
						while (!this.scanner.eof()) {
							el.children = el.children.concat(this.parseJSXChildren());
							var node = this.createJSXChildNode();
							var element = this.parseJSXBoundaryElement();
							if (element.type === jsx_syntax_1.JSXSyntax.JSXOpeningElement) {
								var opening = element;
								if (opening.selfClosing) {
									var child = this.finalize(node, new JSXNode.JSXElement(opening, [], null));
									el.children.push(child);
								} else {
									stack.push(el);
									el = {
										node,
										opening,
										closing: null,
										children: []
									};
								}
							}
							if (element.type === jsx_syntax_1.JSXSyntax.JSXClosingElement) {
								el.closing = element;
								var open_1 = getQualifiedElementName(el.opening.name);
								if (open_1 !== getQualifiedElementName(el.closing.name)) this.tolerateError("Expected corresponding JSX closing tag for %0", open_1);
								if (stack.length > 0) {
									var child = this.finalize(el.node, new JSXNode.JSXElement(el.opening, el.children, el.closing));
									el = stack[stack.length - 1];
									el.children.push(child);
									stack.pop();
								} else break;
							}
						}
						return el;
					};
					JSXParser.prototype.parseJSXElement = function() {
						var node = this.createJSXNode();
						var opening = this.parseJSXOpeningElement();
						var children = [];
						var closing = null;
						if (!opening.selfClosing) {
							var el = this.parseComplexJSXElement({
								node,
								opening,
								closing,
								children
							});
							children = el.children;
							closing = el.closing;
						}
						return this.finalize(node, new JSXNode.JSXElement(opening, children, closing));
					};
					JSXParser.prototype.parseJSXRoot = function() {
						if (this.config.tokens) this.tokens.pop();
						this.startJSX();
						var element = this.parseJSXElement();
						this.finishJSX();
						return element;
					};
					JSXParser.prototype.isStartOfExpression = function() {
						return _super.prototype.isStartOfExpression.call(this) || this.match("<");
					};
					return JSXParser;
				}(parser_1.Parser);
			},
			function(module, exports) {
				"use strict";
				Object.defineProperty(exports, "__esModule", { value: true });
				var Regex = {
					NonAsciiIdentifierStart: /[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u052F\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0-\u08B4\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0AF9\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D\u0C58-\u0C5A\u0C60\u0C61\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D5F-\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F5\u13F8-\u13FD\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191E\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2118-\u211D\u2124\u2126\u2128\u212A-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309B-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FD5\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA69D\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA7AD\uA7B0-\uA7B7\uA7F7-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA8FD\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uA9E0-\uA9E4\uA9E6-\uA9EF\uA9FA-\uA9FE\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA7E-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB65\uAB70-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]|\uD800[\uDC00-\uDC0B\uDC0D-\uDC26\uDC28-\uDC3A\uDC3C\uDC3D\uDC3F-\uDC4D\uDC50-\uDC5D\uDC80-\uDCFA\uDD40-\uDD74\uDE80-\uDE9C\uDEA0-\uDED0\uDF00-\uDF1F\uDF30-\uDF4A\uDF50-\uDF75\uDF80-\uDF9D\uDFA0-\uDFC3\uDFC8-\uDFCF\uDFD1-\uDFD5]|\uD801[\uDC00-\uDC9D\uDD00-\uDD27\uDD30-\uDD63\uDE00-\uDF36\uDF40-\uDF55\uDF60-\uDF67]|\uD802[\uDC00-\uDC05\uDC08\uDC0A-\uDC35\uDC37\uDC38\uDC3C\uDC3F-\uDC55\uDC60-\uDC76\uDC80-\uDC9E\uDCE0-\uDCF2\uDCF4\uDCF5\uDD00-\uDD15\uDD20-\uDD39\uDD80-\uDDB7\uDDBE\uDDBF\uDE00\uDE10-\uDE13\uDE15-\uDE17\uDE19-\uDE33\uDE60-\uDE7C\uDE80-\uDE9C\uDEC0-\uDEC7\uDEC9-\uDEE4\uDF00-\uDF35\uDF40-\uDF55\uDF60-\uDF72\uDF80-\uDF91]|\uD803[\uDC00-\uDC48\uDC80-\uDCB2\uDCC0-\uDCF2]|\uD804[\uDC03-\uDC37\uDC83-\uDCAF\uDCD0-\uDCE8\uDD03-\uDD26\uDD50-\uDD72\uDD76\uDD83-\uDDB2\uDDC1-\uDDC4\uDDDA\uDDDC\uDE00-\uDE11\uDE13-\uDE2B\uDE80-\uDE86\uDE88\uDE8A-\uDE8D\uDE8F-\uDE9D\uDE9F-\uDEA8\uDEB0-\uDEDE\uDF05-\uDF0C\uDF0F\uDF10\uDF13-\uDF28\uDF2A-\uDF30\uDF32\uDF33\uDF35-\uDF39\uDF3D\uDF50\uDF5D-\uDF61]|\uD805[\uDC80-\uDCAF\uDCC4\uDCC5\uDCC7\uDD80-\uDDAE\uDDD8-\uDDDB\uDE00-\uDE2F\uDE44\uDE80-\uDEAA\uDF00-\uDF19]|\uD806[\uDCA0-\uDCDF\uDCFF\uDEC0-\uDEF8]|\uD808[\uDC00-\uDF99]|\uD809[\uDC00-\uDC6E\uDC80-\uDD43]|[\uD80C\uD840-\uD868\uD86A-\uD86C\uD86F-\uD872][\uDC00-\uDFFF]|\uD80D[\uDC00-\uDC2E]|\uD811[\uDC00-\uDE46]|\uD81A[\uDC00-\uDE38\uDE40-\uDE5E\uDED0-\uDEED\uDF00-\uDF2F\uDF40-\uDF43\uDF63-\uDF77\uDF7D-\uDF8F]|\uD81B[\uDF00-\uDF44\uDF50\uDF93-\uDF9F]|\uD82C[\uDC00\uDC01]|\uD82F[\uDC00-\uDC6A\uDC70-\uDC7C\uDC80-\uDC88\uDC90-\uDC99]|\uD835[\uDC00-\uDC54\uDC56-\uDC9C\uDC9E\uDC9F\uDCA2\uDCA5\uDCA6\uDCA9-\uDCAC\uDCAE-\uDCB9\uDCBB\uDCBD-\uDCC3\uDCC5-\uDD05\uDD07-\uDD0A\uDD0D-\uDD14\uDD16-\uDD1C\uDD1E-\uDD39\uDD3B-\uDD3E\uDD40-\uDD44\uDD46\uDD4A-\uDD50\uDD52-\uDEA5\uDEA8-\uDEC0\uDEC2-\uDEDA\uDEDC-\uDEFA\uDEFC-\uDF14\uDF16-\uDF34\uDF36-\uDF4E\uDF50-\uDF6E\uDF70-\uDF88\uDF8A-\uDFA8\uDFAA-\uDFC2\uDFC4-\uDFCB]|\uD83A[\uDC00-\uDCC4]|\uD83B[\uDE00-\uDE03\uDE05-\uDE1F\uDE21\uDE22\uDE24\uDE27\uDE29-\uDE32\uDE34-\uDE37\uDE39\uDE3B\uDE42\uDE47\uDE49\uDE4B\uDE4D-\uDE4F\uDE51\uDE52\uDE54\uDE57\uDE59\uDE5B\uDE5D\uDE5F\uDE61\uDE62\uDE64\uDE67-\uDE6A\uDE6C-\uDE72\uDE74-\uDE77\uDE79-\uDE7C\uDE7E\uDE80-\uDE89\uDE8B-\uDE9B\uDEA1-\uDEA3\uDEA5-\uDEA9\uDEAB-\uDEBB]|\uD869[\uDC00-\uDED6\uDF00-\uDFFF]|\uD86D[\uDC00-\uDF34\uDF40-\uDFFF]|\uD86E[\uDC00-\uDC1D\uDC20-\uDFFF]|\uD873[\uDC00-\uDEA1]|\uD87E[\uDC00-\uDE1D]/,
					NonAsciiIdentifierPart: /[\xAA\xB5\xB7\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0300-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u0483-\u0487\u048A-\u052F\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u05D0-\u05EA\u05F0-\u05F2\u0610-\u061A\u0620-\u0669\u066E-\u06D3\u06D5-\u06DC\u06DF-\u06E8\u06EA-\u06FC\u06FF\u0710-\u074A\u074D-\u07B1\u07C0-\u07F5\u07FA\u0800-\u082D\u0840-\u085B\u08A0-\u08B4\u08E3-\u0963\u0966-\u096F\u0971-\u0983\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BC-\u09C4\u09C7\u09C8\u09CB-\u09CE\u09D7\u09DC\u09DD\u09DF-\u09E3\u09E6-\u09F1\u0A01-\u0A03\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A59-\u0A5C\u0A5E\u0A66-\u0A75\u0A81-\u0A83\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABC-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AD0\u0AE0-\u0AE3\u0AE6-\u0AEF\u0AF9\u0B01-\u0B03\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3C-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B5C\u0B5D\u0B5F-\u0B63\u0B66-\u0B6F\u0B71\u0B82\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD0\u0BD7\u0BE6-\u0BEF\u0C00-\u0C03\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C58-\u0C5A\u0C60-\u0C63\u0C66-\u0C6F\u0C81-\u0C83\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBC-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CDE\u0CE0-\u0CE3\u0CE6-\u0CEF\u0CF1\u0CF2\u0D01-\u0D03\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D-\u0D44\u0D46-\u0D48\u0D4A-\u0D4E\u0D57\u0D5F-\u0D63\u0D66-\u0D6F\u0D7A-\u0D7F\u0D82\u0D83\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DE6-\u0DEF\u0DF2\u0DF3\u0E01-\u0E3A\u0E40-\u0E4E\u0E50-\u0E59\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB9\u0EBB-\u0EBD\u0EC0-\u0EC4\u0EC6\u0EC8-\u0ECD\u0ED0-\u0ED9\u0EDC-\u0EDF\u0F00\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E-\u0F47\u0F49-\u0F6C\u0F71-\u0F84\u0F86-\u0F97\u0F99-\u0FBC\u0FC6\u1000-\u1049\u1050-\u109D\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u135D-\u135F\u1369-\u1371\u1380-\u138F\u13A0-\u13F5\u13F8-\u13FD\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176C\u176E-\u1770\u1772\u1773\u1780-\u17D3\u17D7\u17DC\u17DD\u17E0-\u17E9\u180B-\u180D\u1810-\u1819\u1820-\u1877\u1880-\u18AA\u18B0-\u18F5\u1900-\u191E\u1920-\u192B\u1930-\u193B\u1946-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u19D0-\u19DA\u1A00-\u1A1B\u1A20-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AA7\u1AB0-\u1ABD\u1B00-\u1B4B\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1BF3\u1C00-\u1C37\u1C40-\u1C49\u1C4D-\u1C7D\u1CD0-\u1CD2\u1CD4-\u1CF6\u1CF8\u1CF9\u1D00-\u1DF5\u1DFC-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u200C\u200D\u203F\u2040\u2054\u2071\u207F\u2090-\u209C\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2102\u2107\u210A-\u2113\u2115\u2118-\u211D\u2124\u2126\u2128\u212A-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D7F-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2DE0-\u2DFF\u3005-\u3007\u3021-\u302F\u3031-\u3035\u3038-\u303C\u3041-\u3096\u3099-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FD5\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA62B\uA640-\uA66F\uA674-\uA67D\uA67F-\uA6F1\uA717-\uA71F\uA722-\uA788\uA78B-\uA7AD\uA7B0-\uA7B7\uA7F7-\uA827\uA840-\uA873\uA880-\uA8C4\uA8D0-\uA8D9\uA8E0-\uA8F7\uA8FB\uA8FD\uA900-\uA92D\uA930-\uA953\uA960-\uA97C\uA980-\uA9C0\uA9CF-\uA9D9\uA9E0-\uA9FE\uAA00-\uAA36\uAA40-\uAA4D\uAA50-\uAA59\uAA60-\uAA76\uAA7A-\uAAC2\uAADB-\uAADD\uAAE0-\uAAEF\uAAF2-\uAAF6\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB65\uAB70-\uABEA\uABEC\uABED\uABF0-\uABF9\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE00-\uFE0F\uFE20-\uFE2F\uFE33\uFE34\uFE4D-\uFE4F\uFE70-\uFE74\uFE76-\uFEFC\uFF10-\uFF19\uFF21-\uFF3A\uFF3F\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]|\uD800[\uDC00-\uDC0B\uDC0D-\uDC26\uDC28-\uDC3A\uDC3C\uDC3D\uDC3F-\uDC4D\uDC50-\uDC5D\uDC80-\uDCFA\uDD40-\uDD74\uDDFD\uDE80-\uDE9C\uDEA0-\uDED0\uDEE0\uDF00-\uDF1F\uDF30-\uDF4A\uDF50-\uDF7A\uDF80-\uDF9D\uDFA0-\uDFC3\uDFC8-\uDFCF\uDFD1-\uDFD5]|\uD801[\uDC00-\uDC9D\uDCA0-\uDCA9\uDD00-\uDD27\uDD30-\uDD63\uDE00-\uDF36\uDF40-\uDF55\uDF60-\uDF67]|\uD802[\uDC00-\uDC05\uDC08\uDC0A-\uDC35\uDC37\uDC38\uDC3C\uDC3F-\uDC55\uDC60-\uDC76\uDC80-\uDC9E\uDCE0-\uDCF2\uDCF4\uDCF5\uDD00-\uDD15\uDD20-\uDD39\uDD80-\uDDB7\uDDBE\uDDBF\uDE00-\uDE03\uDE05\uDE06\uDE0C-\uDE13\uDE15-\uDE17\uDE19-\uDE33\uDE38-\uDE3A\uDE3F\uDE60-\uDE7C\uDE80-\uDE9C\uDEC0-\uDEC7\uDEC9-\uDEE6\uDF00-\uDF35\uDF40-\uDF55\uDF60-\uDF72\uDF80-\uDF91]|\uD803[\uDC00-\uDC48\uDC80-\uDCB2\uDCC0-\uDCF2]|\uD804[\uDC00-\uDC46\uDC66-\uDC6F\uDC7F-\uDCBA\uDCD0-\uDCE8\uDCF0-\uDCF9\uDD00-\uDD34\uDD36-\uDD3F\uDD50-\uDD73\uDD76\uDD80-\uDDC4\uDDCA-\uDDCC\uDDD0-\uDDDA\uDDDC\uDE00-\uDE11\uDE13-\uDE37\uDE80-\uDE86\uDE88\uDE8A-\uDE8D\uDE8F-\uDE9D\uDE9F-\uDEA8\uDEB0-\uDEEA\uDEF0-\uDEF9\uDF00-\uDF03\uDF05-\uDF0C\uDF0F\uDF10\uDF13-\uDF28\uDF2A-\uDF30\uDF32\uDF33\uDF35-\uDF39\uDF3C-\uDF44\uDF47\uDF48\uDF4B-\uDF4D\uDF50\uDF57\uDF5D-\uDF63\uDF66-\uDF6C\uDF70-\uDF74]|\uD805[\uDC80-\uDCC5\uDCC7\uDCD0-\uDCD9\uDD80-\uDDB5\uDDB8-\uDDC0\uDDD8-\uDDDD\uDE00-\uDE40\uDE44\uDE50-\uDE59\uDE80-\uDEB7\uDEC0-\uDEC9\uDF00-\uDF19\uDF1D-\uDF2B\uDF30-\uDF39]|\uD806[\uDCA0-\uDCE9\uDCFF\uDEC0-\uDEF8]|\uD808[\uDC00-\uDF99]|\uD809[\uDC00-\uDC6E\uDC80-\uDD43]|[\uD80C\uD840-\uD868\uD86A-\uD86C\uD86F-\uD872][\uDC00-\uDFFF]|\uD80D[\uDC00-\uDC2E]|\uD811[\uDC00-\uDE46]|\uD81A[\uDC00-\uDE38\uDE40-\uDE5E\uDE60-\uDE69\uDED0-\uDEED\uDEF0-\uDEF4\uDF00-\uDF36\uDF40-\uDF43\uDF50-\uDF59\uDF63-\uDF77\uDF7D-\uDF8F]|\uD81B[\uDF00-\uDF44\uDF50-\uDF7E\uDF8F-\uDF9F]|\uD82C[\uDC00\uDC01]|\uD82F[\uDC00-\uDC6A\uDC70-\uDC7C\uDC80-\uDC88\uDC90-\uDC99\uDC9D\uDC9E]|\uD834[\uDD65-\uDD69\uDD6D-\uDD72\uDD7B-\uDD82\uDD85-\uDD8B\uDDAA-\uDDAD\uDE42-\uDE44]|\uD835[\uDC00-\uDC54\uDC56-\uDC9C\uDC9E\uDC9F\uDCA2\uDCA5\uDCA6\uDCA9-\uDCAC\uDCAE-\uDCB9\uDCBB\uDCBD-\uDCC3\uDCC5-\uDD05\uDD07-\uDD0A\uDD0D-\uDD14\uDD16-\uDD1C\uDD1E-\uDD39\uDD3B-\uDD3E\uDD40-\uDD44\uDD46\uDD4A-\uDD50\uDD52-\uDEA5\uDEA8-\uDEC0\uDEC2-\uDEDA\uDEDC-\uDEFA\uDEFC-\uDF14\uDF16-\uDF34\uDF36-\uDF4E\uDF50-\uDF6E\uDF70-\uDF88\uDF8A-\uDFA8\uDFAA-\uDFC2\uDFC4-\uDFCB\uDFCE-\uDFFF]|\uD836[\uDE00-\uDE36\uDE3B-\uDE6C\uDE75\uDE84\uDE9B-\uDE9F\uDEA1-\uDEAF]|\uD83A[\uDC00-\uDCC4\uDCD0-\uDCD6]|\uD83B[\uDE00-\uDE03\uDE05-\uDE1F\uDE21\uDE22\uDE24\uDE27\uDE29-\uDE32\uDE34-\uDE37\uDE39\uDE3B\uDE42\uDE47\uDE49\uDE4B\uDE4D-\uDE4F\uDE51\uDE52\uDE54\uDE57\uDE59\uDE5B\uDE5D\uDE5F\uDE61\uDE62\uDE64\uDE67-\uDE6A\uDE6C-\uDE72\uDE74-\uDE77\uDE79-\uDE7C\uDE7E\uDE80-\uDE89\uDE8B-\uDE9B\uDEA1-\uDEA3\uDEA5-\uDEA9\uDEAB-\uDEBB]|\uD869[\uDC00-\uDED6\uDF00-\uDFFF]|\uD86D[\uDC00-\uDF34\uDF40-\uDFFF]|\uD86E[\uDC00-\uDC1D\uDC20-\uDFFF]|\uD873[\uDC00-\uDEA1]|\uD87E[\uDC00-\uDE1D]|\uDB40[\uDD00-\uDDEF]/
				};
				exports.Character = {
					fromCodePoint: function(cp) {
						return cp < 65536 ? String.fromCharCode(cp) : String.fromCharCode(55296 + (cp - 65536 >> 10)) + String.fromCharCode(56320 + (cp - 65536 & 1023));
					},
					isWhiteSpace: function(cp) {
						return cp === 32 || cp === 9 || cp === 11 || cp === 12 || cp === 160 || cp >= 5760 && [
							5760,
							8192,
							8193,
							8194,
							8195,
							8196,
							8197,
							8198,
							8199,
							8200,
							8201,
							8202,
							8239,
							8287,
							12288,
							65279
						].indexOf(cp) >= 0;
					},
					isLineTerminator: function(cp) {
						return cp === 10 || cp === 13 || cp === 8232 || cp === 8233;
					},
					isIdentifierStart: function(cp) {
						return cp === 36 || cp === 95 || cp >= 65 && cp <= 90 || cp >= 97 && cp <= 122 || cp === 92 || cp >= 128 && Regex.NonAsciiIdentifierStart.test(exports.Character.fromCodePoint(cp));
					},
					isIdentifierPart: function(cp) {
						return cp === 36 || cp === 95 || cp >= 65 && cp <= 90 || cp >= 97 && cp <= 122 || cp >= 48 && cp <= 57 || cp === 92 || cp >= 128 && Regex.NonAsciiIdentifierPart.test(exports.Character.fromCodePoint(cp));
					},
					isDecimalDigit: function(cp) {
						return cp >= 48 && cp <= 57;
					},
					isHexDigit: function(cp) {
						return cp >= 48 && cp <= 57 || cp >= 65 && cp <= 70 || cp >= 97 && cp <= 102;
					},
					isOctalDigit: function(cp) {
						return cp >= 48 && cp <= 55;
					}
				};
			},
			function(module, exports, __webpack_require__) {
				"use strict";
				Object.defineProperty(exports, "__esModule", { value: true });
				var jsx_syntax_1 = __webpack_require__(6);
				exports.JSXClosingElement = function() {
					function JSXClosingElement(name) {
						this.type = jsx_syntax_1.JSXSyntax.JSXClosingElement;
						this.name = name;
					}
					return JSXClosingElement;
				}();
				exports.JSXElement = function() {
					function JSXElement(openingElement, children, closingElement) {
						this.type = jsx_syntax_1.JSXSyntax.JSXElement;
						this.openingElement = openingElement;
						this.children = children;
						this.closingElement = closingElement;
					}
					return JSXElement;
				}();
				exports.JSXEmptyExpression = function() {
					function JSXEmptyExpression() {
						this.type = jsx_syntax_1.JSXSyntax.JSXEmptyExpression;
					}
					return JSXEmptyExpression;
				}();
				exports.JSXExpressionContainer = function() {
					function JSXExpressionContainer(expression) {
						this.type = jsx_syntax_1.JSXSyntax.JSXExpressionContainer;
						this.expression = expression;
					}
					return JSXExpressionContainer;
				}();
				exports.JSXIdentifier = function() {
					function JSXIdentifier(name) {
						this.type = jsx_syntax_1.JSXSyntax.JSXIdentifier;
						this.name = name;
					}
					return JSXIdentifier;
				}();
				exports.JSXMemberExpression = function() {
					function JSXMemberExpression(object, property) {
						this.type = jsx_syntax_1.JSXSyntax.JSXMemberExpression;
						this.object = object;
						this.property = property;
					}
					return JSXMemberExpression;
				}();
				exports.JSXAttribute = function() {
					function JSXAttribute(name, value) {
						this.type = jsx_syntax_1.JSXSyntax.JSXAttribute;
						this.name = name;
						this.value = value;
					}
					return JSXAttribute;
				}();
				exports.JSXNamespacedName = function() {
					function JSXNamespacedName(namespace, name) {
						this.type = jsx_syntax_1.JSXSyntax.JSXNamespacedName;
						this.namespace = namespace;
						this.name = name;
					}
					return JSXNamespacedName;
				}();
				exports.JSXOpeningElement = function() {
					function JSXOpeningElement(name, selfClosing, attributes) {
						this.type = jsx_syntax_1.JSXSyntax.JSXOpeningElement;
						this.name = name;
						this.selfClosing = selfClosing;
						this.attributes = attributes;
					}
					return JSXOpeningElement;
				}();
				exports.JSXSpreadAttribute = function() {
					function JSXSpreadAttribute(argument) {
						this.type = jsx_syntax_1.JSXSyntax.JSXSpreadAttribute;
						this.argument = argument;
					}
					return JSXSpreadAttribute;
				}();
				exports.JSXText = function() {
					function JSXText(value, raw) {
						this.type = jsx_syntax_1.JSXSyntax.JSXText;
						this.value = value;
						this.raw = raw;
					}
					return JSXText;
				}();
			},
			function(module, exports) {
				"use strict";
				Object.defineProperty(exports, "__esModule", { value: true });
				exports.JSXSyntax = {
					JSXAttribute: "JSXAttribute",
					JSXClosingElement: "JSXClosingElement",
					JSXElement: "JSXElement",
					JSXEmptyExpression: "JSXEmptyExpression",
					JSXExpressionContainer: "JSXExpressionContainer",
					JSXIdentifier: "JSXIdentifier",
					JSXMemberExpression: "JSXMemberExpression",
					JSXNamespacedName: "JSXNamespacedName",
					JSXOpeningElement: "JSXOpeningElement",
					JSXSpreadAttribute: "JSXSpreadAttribute",
					JSXText: "JSXText"
				};
			},
			function(module, exports, __webpack_require__) {
				"use strict";
				Object.defineProperty(exports, "__esModule", { value: true });
				var syntax_1 = __webpack_require__(2);
				exports.ArrayExpression = function() {
					function ArrayExpression(elements) {
						this.type = syntax_1.Syntax.ArrayExpression;
						this.elements = elements;
					}
					return ArrayExpression;
				}();
				exports.ArrayPattern = function() {
					function ArrayPattern(elements) {
						this.type = syntax_1.Syntax.ArrayPattern;
						this.elements = elements;
					}
					return ArrayPattern;
				}();
				exports.ArrowFunctionExpression = function() {
					function ArrowFunctionExpression(params, body, expression) {
						this.type = syntax_1.Syntax.ArrowFunctionExpression;
						this.id = null;
						this.params = params;
						this.body = body;
						this.generator = false;
						this.expression = expression;
						this.async = false;
					}
					return ArrowFunctionExpression;
				}();
				exports.AssignmentExpression = function() {
					function AssignmentExpression(operator, left, right) {
						this.type = syntax_1.Syntax.AssignmentExpression;
						this.operator = operator;
						this.left = left;
						this.right = right;
					}
					return AssignmentExpression;
				}();
				exports.AssignmentPattern = function() {
					function AssignmentPattern(left, right) {
						this.type = syntax_1.Syntax.AssignmentPattern;
						this.left = left;
						this.right = right;
					}
					return AssignmentPattern;
				}();
				exports.AsyncArrowFunctionExpression = function() {
					function AsyncArrowFunctionExpression(params, body, expression) {
						this.type = syntax_1.Syntax.ArrowFunctionExpression;
						this.id = null;
						this.params = params;
						this.body = body;
						this.generator = false;
						this.expression = expression;
						this.async = true;
					}
					return AsyncArrowFunctionExpression;
				}();
				exports.AsyncFunctionDeclaration = function() {
					function AsyncFunctionDeclaration(id, params, body) {
						this.type = syntax_1.Syntax.FunctionDeclaration;
						this.id = id;
						this.params = params;
						this.body = body;
						this.generator = false;
						this.expression = false;
						this.async = true;
					}
					return AsyncFunctionDeclaration;
				}();
				exports.AsyncFunctionExpression = function() {
					function AsyncFunctionExpression(id, params, body) {
						this.type = syntax_1.Syntax.FunctionExpression;
						this.id = id;
						this.params = params;
						this.body = body;
						this.generator = false;
						this.expression = false;
						this.async = true;
					}
					return AsyncFunctionExpression;
				}();
				exports.AwaitExpression = function() {
					function AwaitExpression(argument) {
						this.type = syntax_1.Syntax.AwaitExpression;
						this.argument = argument;
					}
					return AwaitExpression;
				}();
				exports.BinaryExpression = function() {
					function BinaryExpression(operator, left, right) {
						var logical = operator === "||" || operator === "&&";
						this.type = logical ? syntax_1.Syntax.LogicalExpression : syntax_1.Syntax.BinaryExpression;
						this.operator = operator;
						this.left = left;
						this.right = right;
					}
					return BinaryExpression;
				}();
				exports.BlockStatement = function() {
					function BlockStatement(body) {
						this.type = syntax_1.Syntax.BlockStatement;
						this.body = body;
					}
					return BlockStatement;
				}();
				exports.BreakStatement = function() {
					function BreakStatement(label) {
						this.type = syntax_1.Syntax.BreakStatement;
						this.label = label;
					}
					return BreakStatement;
				}();
				exports.CallExpression = function() {
					function CallExpression(callee, args) {
						this.type = syntax_1.Syntax.CallExpression;
						this.callee = callee;
						this.arguments = args;
					}
					return CallExpression;
				}();
				exports.CatchClause = function() {
					function CatchClause(param, body) {
						this.type = syntax_1.Syntax.CatchClause;
						this.param = param;
						this.body = body;
					}
					return CatchClause;
				}();
				exports.ClassBody = function() {
					function ClassBody(body) {
						this.type = syntax_1.Syntax.ClassBody;
						this.body = body;
					}
					return ClassBody;
				}();
				exports.ClassDeclaration = function() {
					function ClassDeclaration(id, superClass, body) {
						this.type = syntax_1.Syntax.ClassDeclaration;
						this.id = id;
						this.superClass = superClass;
						this.body = body;
					}
					return ClassDeclaration;
				}();
				exports.ClassExpression = function() {
					function ClassExpression(id, superClass, body) {
						this.type = syntax_1.Syntax.ClassExpression;
						this.id = id;
						this.superClass = superClass;
						this.body = body;
					}
					return ClassExpression;
				}();
				exports.ComputedMemberExpression = function() {
					function ComputedMemberExpression(object, property) {
						this.type = syntax_1.Syntax.MemberExpression;
						this.computed = true;
						this.object = object;
						this.property = property;
					}
					return ComputedMemberExpression;
				}();
				exports.ConditionalExpression = function() {
					function ConditionalExpression(test, consequent, alternate) {
						this.type = syntax_1.Syntax.ConditionalExpression;
						this.test = test;
						this.consequent = consequent;
						this.alternate = alternate;
					}
					return ConditionalExpression;
				}();
				exports.ContinueStatement = function() {
					function ContinueStatement(label) {
						this.type = syntax_1.Syntax.ContinueStatement;
						this.label = label;
					}
					return ContinueStatement;
				}();
				exports.DebuggerStatement = function() {
					function DebuggerStatement() {
						this.type = syntax_1.Syntax.DebuggerStatement;
					}
					return DebuggerStatement;
				}();
				exports.Directive = function() {
					function Directive(expression, directive) {
						this.type = syntax_1.Syntax.ExpressionStatement;
						this.expression = expression;
						this.directive = directive;
					}
					return Directive;
				}();
				exports.DoWhileStatement = function() {
					function DoWhileStatement(body, test) {
						this.type = syntax_1.Syntax.DoWhileStatement;
						this.body = body;
						this.test = test;
					}
					return DoWhileStatement;
				}();
				exports.EmptyStatement = function() {
					function EmptyStatement() {
						this.type = syntax_1.Syntax.EmptyStatement;
					}
					return EmptyStatement;
				}();
				exports.ExportAllDeclaration = function() {
					function ExportAllDeclaration(source) {
						this.type = syntax_1.Syntax.ExportAllDeclaration;
						this.source = source;
					}
					return ExportAllDeclaration;
				}();
				exports.ExportDefaultDeclaration = function() {
					function ExportDefaultDeclaration(declaration) {
						this.type = syntax_1.Syntax.ExportDefaultDeclaration;
						this.declaration = declaration;
					}
					return ExportDefaultDeclaration;
				}();
				exports.ExportNamedDeclaration = function() {
					function ExportNamedDeclaration(declaration, specifiers, source) {
						this.type = syntax_1.Syntax.ExportNamedDeclaration;
						this.declaration = declaration;
						this.specifiers = specifiers;
						this.source = source;
					}
					return ExportNamedDeclaration;
				}();
				exports.ExportSpecifier = function() {
					function ExportSpecifier(local, exported) {
						this.type = syntax_1.Syntax.ExportSpecifier;
						this.exported = exported;
						this.local = local;
					}
					return ExportSpecifier;
				}();
				exports.ExpressionStatement = function() {
					function ExpressionStatement(expression) {
						this.type = syntax_1.Syntax.ExpressionStatement;
						this.expression = expression;
					}
					return ExpressionStatement;
				}();
				exports.ForInStatement = function() {
					function ForInStatement(left, right, body) {
						this.type = syntax_1.Syntax.ForInStatement;
						this.left = left;
						this.right = right;
						this.body = body;
						this.each = false;
					}
					return ForInStatement;
				}();
				exports.ForOfStatement = function() {
					function ForOfStatement(left, right, body) {
						this.type = syntax_1.Syntax.ForOfStatement;
						this.left = left;
						this.right = right;
						this.body = body;
					}
					return ForOfStatement;
				}();
				exports.ForStatement = function() {
					function ForStatement(init, test, update, body) {
						this.type = syntax_1.Syntax.ForStatement;
						this.init = init;
						this.test = test;
						this.update = update;
						this.body = body;
					}
					return ForStatement;
				}();
				exports.FunctionDeclaration = function() {
					function FunctionDeclaration(id, params, body, generator) {
						this.type = syntax_1.Syntax.FunctionDeclaration;
						this.id = id;
						this.params = params;
						this.body = body;
						this.generator = generator;
						this.expression = false;
						this.async = false;
					}
					return FunctionDeclaration;
				}();
				exports.FunctionExpression = function() {
					function FunctionExpression(id, params, body, generator) {
						this.type = syntax_1.Syntax.FunctionExpression;
						this.id = id;
						this.params = params;
						this.body = body;
						this.generator = generator;
						this.expression = false;
						this.async = false;
					}
					return FunctionExpression;
				}();
				exports.Identifier = function() {
					function Identifier(name) {
						this.type = syntax_1.Syntax.Identifier;
						this.name = name;
					}
					return Identifier;
				}();
				exports.IfStatement = function() {
					function IfStatement(test, consequent, alternate) {
						this.type = syntax_1.Syntax.IfStatement;
						this.test = test;
						this.consequent = consequent;
						this.alternate = alternate;
					}
					return IfStatement;
				}();
				exports.ImportDeclaration = function() {
					function ImportDeclaration(specifiers, source) {
						this.type = syntax_1.Syntax.ImportDeclaration;
						this.specifiers = specifiers;
						this.source = source;
					}
					return ImportDeclaration;
				}();
				exports.ImportDefaultSpecifier = function() {
					function ImportDefaultSpecifier(local) {
						this.type = syntax_1.Syntax.ImportDefaultSpecifier;
						this.local = local;
					}
					return ImportDefaultSpecifier;
				}();
				exports.ImportNamespaceSpecifier = function() {
					function ImportNamespaceSpecifier(local) {
						this.type = syntax_1.Syntax.ImportNamespaceSpecifier;
						this.local = local;
					}
					return ImportNamespaceSpecifier;
				}();
				exports.ImportSpecifier = function() {
					function ImportSpecifier(local, imported) {
						this.type = syntax_1.Syntax.ImportSpecifier;
						this.local = local;
						this.imported = imported;
					}
					return ImportSpecifier;
				}();
				exports.LabeledStatement = function() {
					function LabeledStatement(label, body) {
						this.type = syntax_1.Syntax.LabeledStatement;
						this.label = label;
						this.body = body;
					}
					return LabeledStatement;
				}();
				exports.Literal = function() {
					function Literal(value, raw) {
						this.type = syntax_1.Syntax.Literal;
						this.value = value;
						this.raw = raw;
					}
					return Literal;
				}();
				exports.MetaProperty = function() {
					function MetaProperty(meta, property) {
						this.type = syntax_1.Syntax.MetaProperty;
						this.meta = meta;
						this.property = property;
					}
					return MetaProperty;
				}();
				exports.MethodDefinition = function() {
					function MethodDefinition(key, computed, value, kind, isStatic) {
						this.type = syntax_1.Syntax.MethodDefinition;
						this.key = key;
						this.computed = computed;
						this.value = value;
						this.kind = kind;
						this.static = isStatic;
					}
					return MethodDefinition;
				}();
				exports.Module = function() {
					function Module(body) {
						this.type = syntax_1.Syntax.Program;
						this.body = body;
						this.sourceType = "module";
					}
					return Module;
				}();
				exports.NewExpression = function() {
					function NewExpression(callee, args) {
						this.type = syntax_1.Syntax.NewExpression;
						this.callee = callee;
						this.arguments = args;
					}
					return NewExpression;
				}();
				exports.ObjectExpression = function() {
					function ObjectExpression(properties) {
						this.type = syntax_1.Syntax.ObjectExpression;
						this.properties = properties;
					}
					return ObjectExpression;
				}();
				exports.ObjectPattern = function() {
					function ObjectPattern(properties) {
						this.type = syntax_1.Syntax.ObjectPattern;
						this.properties = properties;
					}
					return ObjectPattern;
				}();
				exports.Property = function() {
					function Property(kind, key, computed, value, method, shorthand) {
						this.type = syntax_1.Syntax.Property;
						this.key = key;
						this.computed = computed;
						this.value = value;
						this.kind = kind;
						this.method = method;
						this.shorthand = shorthand;
					}
					return Property;
				}();
				exports.RegexLiteral = function() {
					function RegexLiteral(value, raw, pattern, flags) {
						this.type = syntax_1.Syntax.Literal;
						this.value = value;
						this.raw = raw;
						this.regex = {
							pattern,
							flags
						};
					}
					return RegexLiteral;
				}();
				exports.RestElement = function() {
					function RestElement(argument) {
						this.type = syntax_1.Syntax.RestElement;
						this.argument = argument;
					}
					return RestElement;
				}();
				exports.ReturnStatement = function() {
					function ReturnStatement(argument) {
						this.type = syntax_1.Syntax.ReturnStatement;
						this.argument = argument;
					}
					return ReturnStatement;
				}();
				exports.Script = function() {
					function Script(body) {
						this.type = syntax_1.Syntax.Program;
						this.body = body;
						this.sourceType = "script";
					}
					return Script;
				}();
				exports.SequenceExpression = function() {
					function SequenceExpression(expressions) {
						this.type = syntax_1.Syntax.SequenceExpression;
						this.expressions = expressions;
					}
					return SequenceExpression;
				}();
				exports.SpreadElement = function() {
					function SpreadElement(argument) {
						this.type = syntax_1.Syntax.SpreadElement;
						this.argument = argument;
					}
					return SpreadElement;
				}();
				exports.StaticMemberExpression = function() {
					function StaticMemberExpression(object, property) {
						this.type = syntax_1.Syntax.MemberExpression;
						this.computed = false;
						this.object = object;
						this.property = property;
					}
					return StaticMemberExpression;
				}();
				exports.Super = function() {
					function Super() {
						this.type = syntax_1.Syntax.Super;
					}
					return Super;
				}();
				exports.SwitchCase = function() {
					function SwitchCase(test, consequent) {
						this.type = syntax_1.Syntax.SwitchCase;
						this.test = test;
						this.consequent = consequent;
					}
					return SwitchCase;
				}();
				exports.SwitchStatement = function() {
					function SwitchStatement(discriminant, cases) {
						this.type = syntax_1.Syntax.SwitchStatement;
						this.discriminant = discriminant;
						this.cases = cases;
					}
					return SwitchStatement;
				}();
				exports.TaggedTemplateExpression = function() {
					function TaggedTemplateExpression(tag, quasi) {
						this.type = syntax_1.Syntax.TaggedTemplateExpression;
						this.tag = tag;
						this.quasi = quasi;
					}
					return TaggedTemplateExpression;
				}();
				exports.TemplateElement = function() {
					function TemplateElement(value, tail) {
						this.type = syntax_1.Syntax.TemplateElement;
						this.value = value;
						this.tail = tail;
					}
					return TemplateElement;
				}();
				exports.TemplateLiteral = function() {
					function TemplateLiteral(quasis, expressions) {
						this.type = syntax_1.Syntax.TemplateLiteral;
						this.quasis = quasis;
						this.expressions = expressions;
					}
					return TemplateLiteral;
				}();
				exports.ThisExpression = function() {
					function ThisExpression() {
						this.type = syntax_1.Syntax.ThisExpression;
					}
					return ThisExpression;
				}();
				exports.ThrowStatement = function() {
					function ThrowStatement(argument) {
						this.type = syntax_1.Syntax.ThrowStatement;
						this.argument = argument;
					}
					return ThrowStatement;
				}();
				exports.TryStatement = function() {
					function TryStatement(block, handler, finalizer) {
						this.type = syntax_1.Syntax.TryStatement;
						this.block = block;
						this.handler = handler;
						this.finalizer = finalizer;
					}
					return TryStatement;
				}();
				exports.UnaryExpression = function() {
					function UnaryExpression(operator, argument) {
						this.type = syntax_1.Syntax.UnaryExpression;
						this.operator = operator;
						this.argument = argument;
						this.prefix = true;
					}
					return UnaryExpression;
				}();
				exports.UpdateExpression = function() {
					function UpdateExpression(operator, argument, prefix) {
						this.type = syntax_1.Syntax.UpdateExpression;
						this.operator = operator;
						this.argument = argument;
						this.prefix = prefix;
					}
					return UpdateExpression;
				}();
				exports.VariableDeclaration = function() {
					function VariableDeclaration(declarations, kind) {
						this.type = syntax_1.Syntax.VariableDeclaration;
						this.declarations = declarations;
						this.kind = kind;
					}
					return VariableDeclaration;
				}();
				exports.VariableDeclarator = function() {
					function VariableDeclarator(id, init) {
						this.type = syntax_1.Syntax.VariableDeclarator;
						this.id = id;
						this.init = init;
					}
					return VariableDeclarator;
				}();
				exports.WhileStatement = function() {
					function WhileStatement(test, body) {
						this.type = syntax_1.Syntax.WhileStatement;
						this.test = test;
						this.body = body;
					}
					return WhileStatement;
				}();
				exports.WithStatement = function() {
					function WithStatement(object, body) {
						this.type = syntax_1.Syntax.WithStatement;
						this.object = object;
						this.body = body;
					}
					return WithStatement;
				}();
				exports.YieldExpression = function() {
					function YieldExpression(argument, delegate) {
						this.type = syntax_1.Syntax.YieldExpression;
						this.argument = argument;
						this.delegate = delegate;
					}
					return YieldExpression;
				}();
			},
			function(module, exports, __webpack_require__) {
				"use strict";
				Object.defineProperty(exports, "__esModule", { value: true });
				var assert_1 = __webpack_require__(9);
				var error_handler_1 = __webpack_require__(10);
				var messages_1 = __webpack_require__(11);
				var Node = __webpack_require__(7);
				var scanner_1 = __webpack_require__(12);
				var syntax_1 = __webpack_require__(2);
				var token_1 = __webpack_require__(13);
				var ArrowParameterPlaceHolder = "ArrowParameterPlaceHolder";
				exports.Parser = function() {
					function Parser(code, options, delegate) {
						if (options === void 0) options = {};
						this.config = {
							range: typeof options.range === "boolean" && options.range,
							loc: typeof options.loc === "boolean" && options.loc,
							source: null,
							tokens: typeof options.tokens === "boolean" && options.tokens,
							comment: typeof options.comment === "boolean" && options.comment,
							tolerant: typeof options.tolerant === "boolean" && options.tolerant
						};
						if (this.config.loc && options.source && options.source !== null) this.config.source = String(options.source);
						this.delegate = delegate;
						this.errorHandler = new error_handler_1.ErrorHandler();
						this.errorHandler.tolerant = this.config.tolerant;
						this.scanner = new scanner_1.Scanner(code, this.errorHandler);
						this.scanner.trackComment = this.config.comment;
						this.operatorPrecedence = {
							")": 0,
							";": 0,
							",": 0,
							"=": 0,
							"]": 0,
							"||": 1,
							"&&": 2,
							"|": 3,
							"^": 4,
							"&": 5,
							"==": 6,
							"!=": 6,
							"===": 6,
							"!==": 6,
							"<": 7,
							">": 7,
							"<=": 7,
							">=": 7,
							"<<": 8,
							">>": 8,
							">>>": 8,
							"+": 9,
							"-": 9,
							"*": 11,
							"/": 11,
							"%": 11
						};
						this.lookahead = {
							type: 2,
							value: "",
							lineNumber: this.scanner.lineNumber,
							lineStart: 0,
							start: 0,
							end: 0
						};
						this.hasLineTerminator = false;
						this.context = {
							isModule: false,
							await: false,
							allowIn: true,
							allowStrictDirective: true,
							allowYield: true,
							firstCoverInitializedNameError: null,
							isAssignmentTarget: false,
							isBindingElement: false,
							inFunctionBody: false,
							inIteration: false,
							inSwitch: false,
							labelSet: {},
							strict: false
						};
						this.tokens = [];
						this.startMarker = {
							index: 0,
							line: this.scanner.lineNumber,
							column: 0
						};
						this.lastMarker = {
							index: 0,
							line: this.scanner.lineNumber,
							column: 0
						};
						this.nextToken();
						this.lastMarker = {
							index: this.scanner.index,
							line: this.scanner.lineNumber,
							column: this.scanner.index - this.scanner.lineStart
						};
					}
					Parser.prototype.throwError = function(messageFormat) {
						var values = [];
						for (var _i = 1; _i < arguments.length; _i++) values[_i - 1] = arguments[_i];
						var args = Array.prototype.slice.call(arguments, 1);
						var msg = messageFormat.replace(/%(\d)/g, function(whole, idx) {
							assert_1.assert(idx < args.length, "Message reference must be in range");
							return args[idx];
						});
						var index = this.lastMarker.index;
						var line = this.lastMarker.line;
						var column = this.lastMarker.column + 1;
						throw this.errorHandler.createError(index, line, column, msg);
					};
					Parser.prototype.tolerateError = function(messageFormat) {
						var values = [];
						for (var _i = 1; _i < arguments.length; _i++) values[_i - 1] = arguments[_i];
						var args = Array.prototype.slice.call(arguments, 1);
						var msg = messageFormat.replace(/%(\d)/g, function(whole, idx) {
							assert_1.assert(idx < args.length, "Message reference must be in range");
							return args[idx];
						});
						var index = this.lastMarker.index;
						var line = this.scanner.lineNumber;
						var column = this.lastMarker.column + 1;
						this.errorHandler.tolerateError(index, line, column, msg);
					};
					Parser.prototype.unexpectedTokenError = function(token, message) {
						var msg = message || messages_1.Messages.UnexpectedToken;
						var value;
						if (token) {
							if (!message) {
								msg = token.type === 2 ? messages_1.Messages.UnexpectedEOS : token.type === 3 ? messages_1.Messages.UnexpectedIdentifier : token.type === 6 ? messages_1.Messages.UnexpectedNumber : token.type === 8 ? messages_1.Messages.UnexpectedString : token.type === 10 ? messages_1.Messages.UnexpectedTemplate : messages_1.Messages.UnexpectedToken;
								if (token.type === 4) {
									if (this.scanner.isFutureReservedWord(token.value)) msg = messages_1.Messages.UnexpectedReserved;
									else if (this.context.strict && this.scanner.isStrictModeReservedWord(token.value)) msg = messages_1.Messages.StrictReservedWord;
								}
							}
							value = token.value;
						} else value = "ILLEGAL";
						msg = msg.replace("%0", value);
						if (token && typeof token.lineNumber === "number") {
							var index = token.start;
							var line = token.lineNumber;
							var lastMarkerLineStart = this.lastMarker.index - this.lastMarker.column;
							var column = token.start - lastMarkerLineStart + 1;
							return this.errorHandler.createError(index, line, column, msg);
						} else {
							var index = this.lastMarker.index;
							var line = this.lastMarker.line;
							var column = this.lastMarker.column + 1;
							return this.errorHandler.createError(index, line, column, msg);
						}
					};
					Parser.prototype.throwUnexpectedToken = function(token, message) {
						throw this.unexpectedTokenError(token, message);
					};
					Parser.prototype.tolerateUnexpectedToken = function(token, message) {
						this.errorHandler.tolerate(this.unexpectedTokenError(token, message));
					};
					Parser.prototype.collectComments = function() {
						if (!this.config.comment) this.scanner.scanComments();
						else {
							var comments = this.scanner.scanComments();
							if (comments.length > 0 && this.delegate) for (var i = 0; i < comments.length; ++i) {
								var e = comments[i];
								var node = void 0;
								node = {
									type: e.multiLine ? "BlockComment" : "LineComment",
									value: this.scanner.source.slice(e.slice[0], e.slice[1])
								};
								if (this.config.range) node.range = e.range;
								if (this.config.loc) node.loc = e.loc;
								var metadata = {
									start: {
										line: e.loc.start.line,
										column: e.loc.start.column,
										offset: e.range[0]
									},
									end: {
										line: e.loc.end.line,
										column: e.loc.end.column,
										offset: e.range[1]
									}
								};
								this.delegate(node, metadata);
							}
						}
					};
					Parser.prototype.getTokenRaw = function(token) {
						return this.scanner.source.slice(token.start, token.end);
					};
					Parser.prototype.convertToken = function(token) {
						var t = {
							type: token_1.TokenName[token.type],
							value: this.getTokenRaw(token)
						};
						if (this.config.range) t.range = [token.start, token.end];
						if (this.config.loc) t.loc = {
							start: {
								line: this.startMarker.line,
								column: this.startMarker.column
							},
							end: {
								line: this.scanner.lineNumber,
								column: this.scanner.index - this.scanner.lineStart
							}
						};
						if (token.type === 9) t.regex = {
							pattern: token.pattern,
							flags: token.flags
						};
						return t;
					};
					Parser.prototype.nextToken = function() {
						var token = this.lookahead;
						this.lastMarker.index = this.scanner.index;
						this.lastMarker.line = this.scanner.lineNumber;
						this.lastMarker.column = this.scanner.index - this.scanner.lineStart;
						this.collectComments();
						if (this.scanner.index !== this.startMarker.index) {
							this.startMarker.index = this.scanner.index;
							this.startMarker.line = this.scanner.lineNumber;
							this.startMarker.column = this.scanner.index - this.scanner.lineStart;
						}
						var next = this.scanner.lex();
						this.hasLineTerminator = token.lineNumber !== next.lineNumber;
						if (next && this.context.strict && next.type === 3) {
							if (this.scanner.isStrictModeReservedWord(next.value)) next.type = 4;
						}
						this.lookahead = next;
						if (this.config.tokens && next.type !== 2) this.tokens.push(this.convertToken(next));
						return token;
					};
					Parser.prototype.nextRegexToken = function() {
						this.collectComments();
						var token = this.scanner.scanRegExp();
						if (this.config.tokens) {
							this.tokens.pop();
							this.tokens.push(this.convertToken(token));
						}
						this.lookahead = token;
						this.nextToken();
						return token;
					};
					Parser.prototype.createNode = function() {
						return {
							index: this.startMarker.index,
							line: this.startMarker.line,
							column: this.startMarker.column
						};
					};
					Parser.prototype.startNode = function(token, lastLineStart) {
						if (lastLineStart === void 0) lastLineStart = 0;
						var column = token.start - token.lineStart;
						var line = token.lineNumber;
						if (column < 0) {
							column += lastLineStart;
							line--;
						}
						return {
							index: token.start,
							line,
							column
						};
					};
					Parser.prototype.finalize = function(marker, node) {
						if (this.config.range) node.range = [marker.index, this.lastMarker.index];
						if (this.config.loc) {
							node.loc = {
								start: {
									line: marker.line,
									column: marker.column
								},
								end: {
									line: this.lastMarker.line,
									column: this.lastMarker.column
								}
							};
							if (this.config.source) node.loc.source = this.config.source;
						}
						if (this.delegate) {
							var metadata = {
								start: {
									line: marker.line,
									column: marker.column,
									offset: marker.index
								},
								end: {
									line: this.lastMarker.line,
									column: this.lastMarker.column,
									offset: this.lastMarker.index
								}
							};
							this.delegate(node, metadata);
						}
						return node;
					};
					Parser.prototype.expect = function(value) {
						var token = this.nextToken();
						if (token.type !== 7 || token.value !== value) this.throwUnexpectedToken(token);
					};
					Parser.prototype.expectCommaSeparator = function() {
						if (this.config.tolerant) {
							var token = this.lookahead;
							if (token.type === 7 && token.value === ",") this.nextToken();
							else if (token.type === 7 && token.value === ";") {
								this.nextToken();
								this.tolerateUnexpectedToken(token);
							} else this.tolerateUnexpectedToken(token, messages_1.Messages.UnexpectedToken);
						} else this.expect(",");
					};
					Parser.prototype.expectKeyword = function(keyword) {
						var token = this.nextToken();
						if (token.type !== 4 || token.value !== keyword) this.throwUnexpectedToken(token);
					};
					Parser.prototype.match = function(value) {
						return this.lookahead.type === 7 && this.lookahead.value === value;
					};
					Parser.prototype.matchKeyword = function(keyword) {
						return this.lookahead.type === 4 && this.lookahead.value === keyword;
					};
					Parser.prototype.matchContextualKeyword = function(keyword) {
						return this.lookahead.type === 3 && this.lookahead.value === keyword;
					};
					Parser.prototype.matchAssign = function() {
						if (this.lookahead.type !== 7) return false;
						var op = this.lookahead.value;
						return op === "=" || op === "*=" || op === "**=" || op === "/=" || op === "%=" || op === "+=" || op === "-=" || op === "<<=" || op === ">>=" || op === ">>>=" || op === "&=" || op === "^=" || op === "|=";
					};
					Parser.prototype.isolateCoverGrammar = function(parseFunction) {
						var previousIsBindingElement = this.context.isBindingElement;
						var previousIsAssignmentTarget = this.context.isAssignmentTarget;
						var previousFirstCoverInitializedNameError = this.context.firstCoverInitializedNameError;
						this.context.isBindingElement = true;
						this.context.isAssignmentTarget = true;
						this.context.firstCoverInitializedNameError = null;
						var result = parseFunction.call(this);
						if (this.context.firstCoverInitializedNameError !== null) this.throwUnexpectedToken(this.context.firstCoverInitializedNameError);
						this.context.isBindingElement = previousIsBindingElement;
						this.context.isAssignmentTarget = previousIsAssignmentTarget;
						this.context.firstCoverInitializedNameError = previousFirstCoverInitializedNameError;
						return result;
					};
					Parser.prototype.inheritCoverGrammar = function(parseFunction) {
						var previousIsBindingElement = this.context.isBindingElement;
						var previousIsAssignmentTarget = this.context.isAssignmentTarget;
						var previousFirstCoverInitializedNameError = this.context.firstCoverInitializedNameError;
						this.context.isBindingElement = true;
						this.context.isAssignmentTarget = true;
						this.context.firstCoverInitializedNameError = null;
						var result = parseFunction.call(this);
						this.context.isBindingElement = this.context.isBindingElement && previousIsBindingElement;
						this.context.isAssignmentTarget = this.context.isAssignmentTarget && previousIsAssignmentTarget;
						this.context.firstCoverInitializedNameError = previousFirstCoverInitializedNameError || this.context.firstCoverInitializedNameError;
						return result;
					};
					Parser.prototype.consumeSemicolon = function() {
						if (this.match(";")) this.nextToken();
						else if (!this.hasLineTerminator) {
							if (this.lookahead.type !== 2 && !this.match("}")) this.throwUnexpectedToken(this.lookahead);
							this.lastMarker.index = this.startMarker.index;
							this.lastMarker.line = this.startMarker.line;
							this.lastMarker.column = this.startMarker.column;
						}
					};
					Parser.prototype.parsePrimaryExpression = function() {
						var node = this.createNode();
						var expr;
						var token, raw;
						switch (this.lookahead.type) {
							case 3:
								if ((this.context.isModule || this.context.await) && this.lookahead.value === "await") this.tolerateUnexpectedToken(this.lookahead);
								expr = this.matchAsyncFunction() ? this.parseFunctionExpression() : this.finalize(node, new Node.Identifier(this.nextToken().value));
								break;
							case 6:
							case 8:
								if (this.context.strict && this.lookahead.octal) this.tolerateUnexpectedToken(this.lookahead, messages_1.Messages.StrictOctalLiteral);
								this.context.isAssignmentTarget = false;
								this.context.isBindingElement = false;
								token = this.nextToken();
								raw = this.getTokenRaw(token);
								expr = this.finalize(node, new Node.Literal(token.value, raw));
								break;
							case 1:
								this.context.isAssignmentTarget = false;
								this.context.isBindingElement = false;
								token = this.nextToken();
								raw = this.getTokenRaw(token);
								expr = this.finalize(node, new Node.Literal(token.value === "true", raw));
								break;
							case 5:
								this.context.isAssignmentTarget = false;
								this.context.isBindingElement = false;
								token = this.nextToken();
								raw = this.getTokenRaw(token);
								expr = this.finalize(node, new Node.Literal(null, raw));
								break;
							case 10:
								expr = this.parseTemplateLiteral();
								break;
							case 7:
								switch (this.lookahead.value) {
									case "(":
										this.context.isBindingElement = false;
										expr = this.inheritCoverGrammar(this.parseGroupExpression);
										break;
									case "[":
										expr = this.inheritCoverGrammar(this.parseArrayInitializer);
										break;
									case "{":
										expr = this.inheritCoverGrammar(this.parseObjectInitializer);
										break;
									case "/":
									case "/=":
										this.context.isAssignmentTarget = false;
										this.context.isBindingElement = false;
										this.scanner.index = this.startMarker.index;
										token = this.nextRegexToken();
										raw = this.getTokenRaw(token);
										expr = this.finalize(node, new Node.RegexLiteral(token.regex, raw, token.pattern, token.flags));
										break;
									default: expr = this.throwUnexpectedToken(this.nextToken());
								}
								break;
							case 4:
								if (!this.context.strict && this.context.allowYield && this.matchKeyword("yield")) expr = this.parseIdentifierName();
								else if (!this.context.strict && this.matchKeyword("let")) expr = this.finalize(node, new Node.Identifier(this.nextToken().value));
								else {
									this.context.isAssignmentTarget = false;
									this.context.isBindingElement = false;
									if (this.matchKeyword("function")) expr = this.parseFunctionExpression();
									else if (this.matchKeyword("this")) {
										this.nextToken();
										expr = this.finalize(node, new Node.ThisExpression());
									} else if (this.matchKeyword("class")) expr = this.parseClassExpression();
									else expr = this.throwUnexpectedToken(this.nextToken());
								}
								break;
							default: expr = this.throwUnexpectedToken(this.nextToken());
						}
						return expr;
					};
					Parser.prototype.parseSpreadElement = function() {
						var node = this.createNode();
						this.expect("...");
						var arg = this.inheritCoverGrammar(this.parseAssignmentExpression);
						return this.finalize(node, new Node.SpreadElement(arg));
					};
					Parser.prototype.parseArrayInitializer = function() {
						var node = this.createNode();
						var elements = [];
						this.expect("[");
						while (!this.match("]")) if (this.match(",")) {
							this.nextToken();
							elements.push(null);
						} else if (this.match("...")) {
							var element = this.parseSpreadElement();
							if (!this.match("]")) {
								this.context.isAssignmentTarget = false;
								this.context.isBindingElement = false;
								this.expect(",");
							}
							elements.push(element);
						} else {
							elements.push(this.inheritCoverGrammar(this.parseAssignmentExpression));
							if (!this.match("]")) this.expect(",");
						}
						this.expect("]");
						return this.finalize(node, new Node.ArrayExpression(elements));
					};
					Parser.prototype.parsePropertyMethod = function(params) {
						this.context.isAssignmentTarget = false;
						this.context.isBindingElement = false;
						var previousStrict = this.context.strict;
						var previousAllowStrictDirective = this.context.allowStrictDirective;
						this.context.allowStrictDirective = params.simple;
						var body = this.isolateCoverGrammar(this.parseFunctionSourceElements);
						if (this.context.strict && params.firstRestricted) this.tolerateUnexpectedToken(params.firstRestricted, params.message);
						if (this.context.strict && params.stricted) this.tolerateUnexpectedToken(params.stricted, params.message);
						this.context.strict = previousStrict;
						this.context.allowStrictDirective = previousAllowStrictDirective;
						return body;
					};
					Parser.prototype.parsePropertyMethodFunction = function() {
						var isGenerator = false;
						var node = this.createNode();
						var previousAllowYield = this.context.allowYield;
						this.context.allowYield = true;
						var params = this.parseFormalParameters();
						var method = this.parsePropertyMethod(params);
						this.context.allowYield = previousAllowYield;
						return this.finalize(node, new Node.FunctionExpression(null, params.params, method, isGenerator));
					};
					Parser.prototype.parsePropertyMethodAsyncFunction = function() {
						var node = this.createNode();
						var previousAllowYield = this.context.allowYield;
						var previousAwait = this.context.await;
						this.context.allowYield = false;
						this.context.await = true;
						var params = this.parseFormalParameters();
						var method = this.parsePropertyMethod(params);
						this.context.allowYield = previousAllowYield;
						this.context.await = previousAwait;
						return this.finalize(node, new Node.AsyncFunctionExpression(null, params.params, method));
					};
					Parser.prototype.parseObjectPropertyKey = function() {
						var node = this.createNode();
						var token = this.nextToken();
						var key;
						switch (token.type) {
							case 8:
							case 6:
								if (this.context.strict && token.octal) this.tolerateUnexpectedToken(token, messages_1.Messages.StrictOctalLiteral);
								var raw = this.getTokenRaw(token);
								key = this.finalize(node, new Node.Literal(token.value, raw));
								break;
							case 3:
							case 1:
							case 5:
							case 4:
								key = this.finalize(node, new Node.Identifier(token.value));
								break;
							case 7:
								if (token.value === "[") {
									key = this.isolateCoverGrammar(this.parseAssignmentExpression);
									this.expect("]");
								} else key = this.throwUnexpectedToken(token);
								break;
							default: key = this.throwUnexpectedToken(token);
						}
						return key;
					};
					Parser.prototype.isPropertyKey = function(key, value) {
						return key.type === syntax_1.Syntax.Identifier && key.name === value || key.type === syntax_1.Syntax.Literal && key.value === value;
					};
					Parser.prototype.parseObjectProperty = function(hasProto) {
						var node = this.createNode();
						var token = this.lookahead;
						var kind;
						var key = null;
						var value = null;
						var computed = false;
						var method = false;
						var shorthand = false;
						var isAsync = false;
						if (token.type === 3) {
							var id = token.value;
							this.nextToken();
							computed = this.match("[");
							isAsync = !this.hasLineTerminator && id === "async" && !this.match(":") && !this.match("(") && !this.match("*") && !this.match(",");
							key = isAsync ? this.parseObjectPropertyKey() : this.finalize(node, new Node.Identifier(id));
						} else if (this.match("*")) this.nextToken();
						else {
							computed = this.match("[");
							key = this.parseObjectPropertyKey();
						}
						var lookaheadPropertyKey = this.qualifiedPropertyName(this.lookahead);
						if (token.type === 3 && !isAsync && token.value === "get" && lookaheadPropertyKey) {
							kind = "get";
							computed = this.match("[");
							key = this.parseObjectPropertyKey();
							this.context.allowYield = false;
							value = this.parseGetterMethod();
						} else if (token.type === 3 && !isAsync && token.value === "set" && lookaheadPropertyKey) {
							kind = "set";
							computed = this.match("[");
							key = this.parseObjectPropertyKey();
							value = this.parseSetterMethod();
						} else if (token.type === 7 && token.value === "*" && lookaheadPropertyKey) {
							kind = "init";
							computed = this.match("[");
							key = this.parseObjectPropertyKey();
							value = this.parseGeneratorMethod();
							method = true;
						} else {
							if (!key) this.throwUnexpectedToken(this.lookahead);
							kind = "init";
							if (this.match(":") && !isAsync) {
								if (!computed && this.isPropertyKey(key, "__proto__")) {
									if (hasProto.value) this.tolerateError(messages_1.Messages.DuplicateProtoProperty);
									hasProto.value = true;
								}
								this.nextToken();
								value = this.inheritCoverGrammar(this.parseAssignmentExpression);
							} else if (this.match("(")) {
								value = isAsync ? this.parsePropertyMethodAsyncFunction() : this.parsePropertyMethodFunction();
								method = true;
							} else if (token.type === 3) {
								var id = this.finalize(node, new Node.Identifier(token.value));
								if (this.match("=")) {
									this.context.firstCoverInitializedNameError = this.lookahead;
									this.nextToken();
									shorthand = true;
									var init = this.isolateCoverGrammar(this.parseAssignmentExpression);
									value = this.finalize(node, new Node.AssignmentPattern(id, init));
								} else {
									shorthand = true;
									value = id;
								}
							} else this.throwUnexpectedToken(this.nextToken());
						}
						return this.finalize(node, new Node.Property(kind, key, computed, value, method, shorthand));
					};
					Parser.prototype.parseObjectInitializer = function() {
						var node = this.createNode();
						this.expect("{");
						var properties = [];
						var hasProto = { value: false };
						while (!this.match("}")) {
							properties.push(this.parseObjectProperty(hasProto));
							if (!this.match("}")) this.expectCommaSeparator();
						}
						this.expect("}");
						return this.finalize(node, new Node.ObjectExpression(properties));
					};
					Parser.prototype.parseTemplateHead = function() {
						assert_1.assert(this.lookahead.head, "Template literal must start with a template head");
						var node = this.createNode();
						var token = this.nextToken();
						var raw = token.value;
						var cooked = token.cooked;
						return this.finalize(node, new Node.TemplateElement({
							raw,
							cooked
						}, token.tail));
					};
					Parser.prototype.parseTemplateElement = function() {
						if (this.lookahead.type !== 10) this.throwUnexpectedToken();
						var node = this.createNode();
						var token = this.nextToken();
						var raw = token.value;
						var cooked = token.cooked;
						return this.finalize(node, new Node.TemplateElement({
							raw,
							cooked
						}, token.tail));
					};
					Parser.prototype.parseTemplateLiteral = function() {
						var node = this.createNode();
						var expressions = [];
						var quasis = [];
						var quasi = this.parseTemplateHead();
						quasis.push(quasi);
						while (!quasi.tail) {
							expressions.push(this.parseExpression());
							quasi = this.parseTemplateElement();
							quasis.push(quasi);
						}
						return this.finalize(node, new Node.TemplateLiteral(quasis, expressions));
					};
					Parser.prototype.reinterpretExpressionAsPattern = function(expr) {
						switch (expr.type) {
							case syntax_1.Syntax.Identifier:
							case syntax_1.Syntax.MemberExpression:
							case syntax_1.Syntax.RestElement:
							case syntax_1.Syntax.AssignmentPattern: break;
							case syntax_1.Syntax.SpreadElement:
								expr.type = syntax_1.Syntax.RestElement;
								this.reinterpretExpressionAsPattern(expr.argument);
								break;
							case syntax_1.Syntax.ArrayExpression:
								expr.type = syntax_1.Syntax.ArrayPattern;
								for (var i = 0; i < expr.elements.length; i++) if (expr.elements[i] !== null) this.reinterpretExpressionAsPattern(expr.elements[i]);
								break;
							case syntax_1.Syntax.ObjectExpression:
								expr.type = syntax_1.Syntax.ObjectPattern;
								for (var i = 0; i < expr.properties.length; i++) this.reinterpretExpressionAsPattern(expr.properties[i].value);
								break;
							case syntax_1.Syntax.AssignmentExpression:
								expr.type = syntax_1.Syntax.AssignmentPattern;
								delete expr.operator;
								this.reinterpretExpressionAsPattern(expr.left);
						}
					};
					Parser.prototype.parseGroupExpression = function() {
						var expr;
						this.expect("(");
						if (this.match(")")) {
							this.nextToken();
							if (!this.match("=>")) this.expect("=>");
							expr = {
								type: ArrowParameterPlaceHolder,
								params: [],
								async: false
							};
						} else {
							var startToken = this.lookahead;
							var params = [];
							if (this.match("...")) {
								expr = this.parseRestElement(params);
								this.expect(")");
								if (!this.match("=>")) this.expect("=>");
								expr = {
									type: ArrowParameterPlaceHolder,
									params: [expr],
									async: false
								};
							} else {
								var arrow = false;
								this.context.isBindingElement = true;
								expr = this.inheritCoverGrammar(this.parseAssignmentExpression);
								if (this.match(",")) {
									var expressions = [];
									this.context.isAssignmentTarget = false;
									expressions.push(expr);
									while (this.lookahead.type !== 2) {
										if (!this.match(",")) break;
										this.nextToken();
										if (this.match(")")) {
											this.nextToken();
											for (var i = 0; i < expressions.length; i++) this.reinterpretExpressionAsPattern(expressions[i]);
											arrow = true;
											expr = {
												type: ArrowParameterPlaceHolder,
												params: expressions,
												async: false
											};
										} else if (this.match("...")) {
											if (!this.context.isBindingElement) this.throwUnexpectedToken(this.lookahead);
											expressions.push(this.parseRestElement(params));
											this.expect(")");
											if (!this.match("=>")) this.expect("=>");
											this.context.isBindingElement = false;
											for (var i = 0; i < expressions.length; i++) this.reinterpretExpressionAsPattern(expressions[i]);
											arrow = true;
											expr = {
												type: ArrowParameterPlaceHolder,
												params: expressions,
												async: false
											};
										} else expressions.push(this.inheritCoverGrammar(this.parseAssignmentExpression));
										if (arrow) break;
									}
									if (!arrow) expr = this.finalize(this.startNode(startToken), new Node.SequenceExpression(expressions));
								}
								if (!arrow) {
									this.expect(")");
									if (this.match("=>")) {
										if (expr.type === syntax_1.Syntax.Identifier && expr.name === "yield") {
											arrow = true;
											expr = {
												type: ArrowParameterPlaceHolder,
												params: [expr],
												async: false
											};
										}
										if (!arrow) {
											if (!this.context.isBindingElement) this.throwUnexpectedToken(this.lookahead);
											if (expr.type === syntax_1.Syntax.SequenceExpression) for (var i = 0; i < expr.expressions.length; i++) this.reinterpretExpressionAsPattern(expr.expressions[i]);
											else this.reinterpretExpressionAsPattern(expr);
											expr = {
												type: ArrowParameterPlaceHolder,
												params: expr.type === syntax_1.Syntax.SequenceExpression ? expr.expressions : [expr],
												async: false
											};
										}
									}
									this.context.isBindingElement = false;
								}
							}
						}
						return expr;
					};
					Parser.prototype.parseArguments = function() {
						this.expect("(");
						var args = [];
						if (!this.match(")")) while (true) {
							var expr = this.match("...") ? this.parseSpreadElement() : this.isolateCoverGrammar(this.parseAssignmentExpression);
							args.push(expr);
							if (this.match(")")) break;
							this.expectCommaSeparator();
							if (this.match(")")) break;
						}
						this.expect(")");
						return args;
					};
					Parser.prototype.isIdentifierName = function(token) {
						return token.type === 3 || token.type === 4 || token.type === 1 || token.type === 5;
					};
					Parser.prototype.parseIdentifierName = function() {
						var node = this.createNode();
						var token = this.nextToken();
						if (!this.isIdentifierName(token)) this.throwUnexpectedToken(token);
						return this.finalize(node, new Node.Identifier(token.value));
					};
					Parser.prototype.parseNewExpression = function() {
						var node = this.createNode();
						var id = this.parseIdentifierName();
						assert_1.assert(id.name === "new", "New expression must start with `new`");
						var expr;
						if (this.match(".")) {
							this.nextToken();
							if (this.lookahead.type === 3 && this.context.inFunctionBody && this.lookahead.value === "target") {
								var property = this.parseIdentifierName();
								expr = new Node.MetaProperty(id, property);
							} else this.throwUnexpectedToken(this.lookahead);
						} else {
							var callee = this.isolateCoverGrammar(this.parseLeftHandSideExpression);
							var args = this.match("(") ? this.parseArguments() : [];
							expr = new Node.NewExpression(callee, args);
							this.context.isAssignmentTarget = false;
							this.context.isBindingElement = false;
						}
						return this.finalize(node, expr);
					};
					Parser.prototype.parseAsyncArgument = function() {
						var arg = this.parseAssignmentExpression();
						this.context.firstCoverInitializedNameError = null;
						return arg;
					};
					Parser.prototype.parseAsyncArguments = function() {
						this.expect("(");
						var args = [];
						if (!this.match(")")) while (true) {
							var expr = this.match("...") ? this.parseSpreadElement() : this.isolateCoverGrammar(this.parseAsyncArgument);
							args.push(expr);
							if (this.match(")")) break;
							this.expectCommaSeparator();
							if (this.match(")")) break;
						}
						this.expect(")");
						return args;
					};
					Parser.prototype.parseLeftHandSideExpressionAllowCall = function() {
						var startToken = this.lookahead;
						var maybeAsync = this.matchContextualKeyword("async");
						var previousAllowIn = this.context.allowIn;
						this.context.allowIn = true;
						var expr;
						if (this.matchKeyword("super") && this.context.inFunctionBody) {
							expr = this.createNode();
							this.nextToken();
							expr = this.finalize(expr, new Node.Super());
							if (!this.match("(") && !this.match(".") && !this.match("[")) this.throwUnexpectedToken(this.lookahead);
						} else expr = this.inheritCoverGrammar(this.matchKeyword("new") ? this.parseNewExpression : this.parsePrimaryExpression);
						while (true) if (this.match(".")) {
							this.context.isBindingElement = false;
							this.context.isAssignmentTarget = true;
							this.expect(".");
							var property = this.parseIdentifierName();
							expr = this.finalize(this.startNode(startToken), new Node.StaticMemberExpression(expr, property));
						} else if (this.match("(")) {
							var asyncArrow = maybeAsync && startToken.lineNumber === this.lookahead.lineNumber;
							this.context.isBindingElement = false;
							this.context.isAssignmentTarget = false;
							var args = asyncArrow ? this.parseAsyncArguments() : this.parseArguments();
							expr = this.finalize(this.startNode(startToken), new Node.CallExpression(expr, args));
							if (asyncArrow && this.match("=>")) {
								for (var i = 0; i < args.length; ++i) this.reinterpretExpressionAsPattern(args[i]);
								expr = {
									type: ArrowParameterPlaceHolder,
									params: args,
									async: true
								};
							}
						} else if (this.match("[")) {
							this.context.isBindingElement = false;
							this.context.isAssignmentTarget = true;
							this.expect("[");
							var property = this.isolateCoverGrammar(this.parseExpression);
							this.expect("]");
							expr = this.finalize(this.startNode(startToken), new Node.ComputedMemberExpression(expr, property));
						} else if (this.lookahead.type === 10 && this.lookahead.head) {
							var quasi = this.parseTemplateLiteral();
							expr = this.finalize(this.startNode(startToken), new Node.TaggedTemplateExpression(expr, quasi));
						} else break;
						this.context.allowIn = previousAllowIn;
						return expr;
					};
					Parser.prototype.parseSuper = function() {
						var node = this.createNode();
						this.expectKeyword("super");
						if (!this.match("[") && !this.match(".")) this.throwUnexpectedToken(this.lookahead);
						return this.finalize(node, new Node.Super());
					};
					Parser.prototype.parseLeftHandSideExpression = function() {
						assert_1.assert(this.context.allowIn, "callee of new expression always allow in keyword.");
						var node = this.startNode(this.lookahead);
						var expr = this.matchKeyword("super") && this.context.inFunctionBody ? this.parseSuper() : this.inheritCoverGrammar(this.matchKeyword("new") ? this.parseNewExpression : this.parsePrimaryExpression);
						while (true) if (this.match("[")) {
							this.context.isBindingElement = false;
							this.context.isAssignmentTarget = true;
							this.expect("[");
							var property = this.isolateCoverGrammar(this.parseExpression);
							this.expect("]");
							expr = this.finalize(node, new Node.ComputedMemberExpression(expr, property));
						} else if (this.match(".")) {
							this.context.isBindingElement = false;
							this.context.isAssignmentTarget = true;
							this.expect(".");
							var property = this.parseIdentifierName();
							expr = this.finalize(node, new Node.StaticMemberExpression(expr, property));
						} else if (this.lookahead.type === 10 && this.lookahead.head) {
							var quasi = this.parseTemplateLiteral();
							expr = this.finalize(node, new Node.TaggedTemplateExpression(expr, quasi));
						} else break;
						return expr;
					};
					Parser.prototype.parseUpdateExpression = function() {
						var expr;
						var startToken = this.lookahead;
						if (this.match("++") || this.match("--")) {
							var node = this.startNode(startToken);
							var token = this.nextToken();
							expr = this.inheritCoverGrammar(this.parseUnaryExpression);
							if (this.context.strict && expr.type === syntax_1.Syntax.Identifier && this.scanner.isRestrictedWord(expr.name)) this.tolerateError(messages_1.Messages.StrictLHSPrefix);
							if (!this.context.isAssignmentTarget) this.tolerateError(messages_1.Messages.InvalidLHSInAssignment);
							var prefix = true;
							expr = this.finalize(node, new Node.UpdateExpression(token.value, expr, prefix));
							this.context.isAssignmentTarget = false;
							this.context.isBindingElement = false;
						} else {
							expr = this.inheritCoverGrammar(this.parseLeftHandSideExpressionAllowCall);
							if (!this.hasLineTerminator && this.lookahead.type === 7) {
								if (this.match("++") || this.match("--")) {
									if (this.context.strict && expr.type === syntax_1.Syntax.Identifier && this.scanner.isRestrictedWord(expr.name)) this.tolerateError(messages_1.Messages.StrictLHSPostfix);
									if (!this.context.isAssignmentTarget) this.tolerateError(messages_1.Messages.InvalidLHSInAssignment);
									this.context.isAssignmentTarget = false;
									this.context.isBindingElement = false;
									var operator = this.nextToken().value;
									var prefix = false;
									expr = this.finalize(this.startNode(startToken), new Node.UpdateExpression(operator, expr, prefix));
								}
							}
						}
						return expr;
					};
					Parser.prototype.parseAwaitExpression = function() {
						var node = this.createNode();
						this.nextToken();
						var argument = this.parseUnaryExpression();
						return this.finalize(node, new Node.AwaitExpression(argument));
					};
					Parser.prototype.parseUnaryExpression = function() {
						var expr;
						if (this.match("+") || this.match("-") || this.match("~") || this.match("!") || this.matchKeyword("delete") || this.matchKeyword("void") || this.matchKeyword("typeof")) {
							var node = this.startNode(this.lookahead);
							var token = this.nextToken();
							expr = this.inheritCoverGrammar(this.parseUnaryExpression);
							expr = this.finalize(node, new Node.UnaryExpression(token.value, expr));
							if (this.context.strict && expr.operator === "delete" && expr.argument.type === syntax_1.Syntax.Identifier) this.tolerateError(messages_1.Messages.StrictDelete);
							this.context.isAssignmentTarget = false;
							this.context.isBindingElement = false;
						} else if (this.context.await && this.matchContextualKeyword("await")) expr = this.parseAwaitExpression();
						else expr = this.parseUpdateExpression();
						return expr;
					};
					Parser.prototype.parseExponentiationExpression = function() {
						var startToken = this.lookahead;
						var expr = this.inheritCoverGrammar(this.parseUnaryExpression);
						if (expr.type !== syntax_1.Syntax.UnaryExpression && this.match("**")) {
							this.nextToken();
							this.context.isAssignmentTarget = false;
							this.context.isBindingElement = false;
							var left = expr;
							var right = this.isolateCoverGrammar(this.parseExponentiationExpression);
							expr = this.finalize(this.startNode(startToken), new Node.BinaryExpression("**", left, right));
						}
						return expr;
					};
					Parser.prototype.binaryPrecedence = function(token) {
						var op = token.value;
						var precedence;
						if (token.type === 7) precedence = this.operatorPrecedence[op] || 0;
						else if (token.type === 4) precedence = op === "instanceof" || this.context.allowIn && op === "in" ? 7 : 0;
						else precedence = 0;
						return precedence;
					};
					Parser.prototype.parseBinaryExpression = function() {
						var startToken = this.lookahead;
						var expr = this.inheritCoverGrammar(this.parseExponentiationExpression);
						var token = this.lookahead;
						var prec = this.binaryPrecedence(token);
						if (prec > 0) {
							this.nextToken();
							this.context.isAssignmentTarget = false;
							this.context.isBindingElement = false;
							var markers = [startToken, this.lookahead];
							var left = expr;
							var right = this.isolateCoverGrammar(this.parseExponentiationExpression);
							var stack = [
								left,
								token.value,
								right
							];
							var precedences = [prec];
							while (true) {
								prec = this.binaryPrecedence(this.lookahead);
								if (prec <= 0) break;
								while (stack.length > 2 && prec <= precedences[precedences.length - 1]) {
									right = stack.pop();
									var operator = stack.pop();
									precedences.pop();
									left = stack.pop();
									markers.pop();
									var node = this.startNode(markers[markers.length - 1]);
									stack.push(this.finalize(node, new Node.BinaryExpression(operator, left, right)));
								}
								stack.push(this.nextToken().value);
								precedences.push(prec);
								markers.push(this.lookahead);
								stack.push(this.isolateCoverGrammar(this.parseExponentiationExpression));
							}
							var i = stack.length - 1;
							expr = stack[i];
							var lastMarker = markers.pop();
							while (i > 1) {
								var marker = markers.pop();
								var lastLineStart = lastMarker && lastMarker.lineStart;
								var node = this.startNode(marker, lastLineStart);
								var operator = stack[i - 1];
								expr = this.finalize(node, new Node.BinaryExpression(operator, stack[i - 2], expr));
								i -= 2;
								lastMarker = marker;
							}
						}
						return expr;
					};
					Parser.prototype.parseConditionalExpression = function() {
						var startToken = this.lookahead;
						var expr = this.inheritCoverGrammar(this.parseBinaryExpression);
						if (this.match("?")) {
							this.nextToken();
							var previousAllowIn = this.context.allowIn;
							this.context.allowIn = true;
							var consequent = this.isolateCoverGrammar(this.parseAssignmentExpression);
							this.context.allowIn = previousAllowIn;
							this.expect(":");
							var alternate = this.isolateCoverGrammar(this.parseAssignmentExpression);
							expr = this.finalize(this.startNode(startToken), new Node.ConditionalExpression(expr, consequent, alternate));
							this.context.isAssignmentTarget = false;
							this.context.isBindingElement = false;
						}
						return expr;
					};
					Parser.prototype.checkPatternParam = function(options, param) {
						switch (param.type) {
							case syntax_1.Syntax.Identifier:
								this.validateParam(options, param, param.name);
								break;
							case syntax_1.Syntax.RestElement:
								this.checkPatternParam(options, param.argument);
								break;
							case syntax_1.Syntax.AssignmentPattern:
								this.checkPatternParam(options, param.left);
								break;
							case syntax_1.Syntax.ArrayPattern:
								for (var i = 0; i < param.elements.length; i++) if (param.elements[i] !== null) this.checkPatternParam(options, param.elements[i]);
								break;
							case syntax_1.Syntax.ObjectPattern: for (var i = 0; i < param.properties.length; i++) this.checkPatternParam(options, param.properties[i].value);
						}
						options.simple = options.simple && param instanceof Node.Identifier;
					};
					Parser.prototype.reinterpretAsCoverFormalsList = function(expr) {
						var params = [expr];
						var options;
						var asyncArrow = false;
						switch (expr.type) {
							case syntax_1.Syntax.Identifier: break;
							case ArrowParameterPlaceHolder:
								params = expr.params;
								asyncArrow = expr.async;
								break;
							default: return null;
						}
						options = {
							simple: true,
							paramSet: {}
						};
						for (var i = 0; i < params.length; ++i) {
							var param = params[i];
							if (param.type === syntax_1.Syntax.AssignmentPattern) {
								if (param.right.type === syntax_1.Syntax.YieldExpression) {
									if (param.right.argument) this.throwUnexpectedToken(this.lookahead);
									param.right.type = syntax_1.Syntax.Identifier;
									param.right.name = "yield";
									delete param.right.argument;
									delete param.right.delegate;
								}
							} else if (asyncArrow && param.type === syntax_1.Syntax.Identifier && param.name === "await") this.throwUnexpectedToken(this.lookahead);
							this.checkPatternParam(options, param);
							params[i] = param;
						}
						if (this.context.strict || !this.context.allowYield) for (var i = 0; i < params.length; ++i) {
							var param = params[i];
							if (param.type === syntax_1.Syntax.YieldExpression) this.throwUnexpectedToken(this.lookahead);
						}
						if (options.message === messages_1.Messages.StrictParamDupe) {
							var token = this.context.strict ? options.stricted : options.firstRestricted;
							this.throwUnexpectedToken(token, options.message);
						}
						return {
							simple: options.simple,
							params,
							stricted: options.stricted,
							firstRestricted: options.firstRestricted,
							message: options.message
						};
					};
					Parser.prototype.parseAssignmentExpression = function() {
						var expr;
						if (!this.context.allowYield && this.matchKeyword("yield")) expr = this.parseYieldExpression();
						else {
							var startToken = this.lookahead;
							var token = startToken;
							expr = this.parseConditionalExpression();
							if (token.type === 3 && token.lineNumber === this.lookahead.lineNumber && token.value === "async") {
								if (this.lookahead.type === 3 || this.matchKeyword("yield")) {
									var arg = this.parsePrimaryExpression();
									this.reinterpretExpressionAsPattern(arg);
									expr = {
										type: ArrowParameterPlaceHolder,
										params: [arg],
										async: true
									};
								}
							}
							if (expr.type === ArrowParameterPlaceHolder || this.match("=>")) {
								this.context.isAssignmentTarget = false;
								this.context.isBindingElement = false;
								var isAsync = expr.async;
								var list = this.reinterpretAsCoverFormalsList(expr);
								if (list) {
									if (this.hasLineTerminator) this.tolerateUnexpectedToken(this.lookahead);
									this.context.firstCoverInitializedNameError = null;
									var previousStrict = this.context.strict;
									var previousAllowStrictDirective = this.context.allowStrictDirective;
									this.context.allowStrictDirective = list.simple;
									var previousAllowYield = this.context.allowYield;
									var previousAwait = this.context.await;
									this.context.allowYield = true;
									this.context.await = isAsync;
									var node = this.startNode(startToken);
									this.expect("=>");
									var body = void 0;
									if (this.match("{")) {
										var previousAllowIn = this.context.allowIn;
										this.context.allowIn = true;
										body = this.parseFunctionSourceElements();
										this.context.allowIn = previousAllowIn;
									} else body = this.isolateCoverGrammar(this.parseAssignmentExpression);
									var expression = body.type !== syntax_1.Syntax.BlockStatement;
									if (this.context.strict && list.firstRestricted) this.throwUnexpectedToken(list.firstRestricted, list.message);
									if (this.context.strict && list.stricted) this.tolerateUnexpectedToken(list.stricted, list.message);
									expr = isAsync ? this.finalize(node, new Node.AsyncArrowFunctionExpression(list.params, body, expression)) : this.finalize(node, new Node.ArrowFunctionExpression(list.params, body, expression));
									this.context.strict = previousStrict;
									this.context.allowStrictDirective = previousAllowStrictDirective;
									this.context.allowYield = previousAllowYield;
									this.context.await = previousAwait;
								}
							} else if (this.matchAssign()) {
								if (!this.context.isAssignmentTarget) this.tolerateError(messages_1.Messages.InvalidLHSInAssignment);
								if (this.context.strict && expr.type === syntax_1.Syntax.Identifier) {
									var id = expr;
									if (this.scanner.isRestrictedWord(id.name)) this.tolerateUnexpectedToken(token, messages_1.Messages.StrictLHSAssignment);
									if (this.scanner.isStrictModeReservedWord(id.name)) this.tolerateUnexpectedToken(token, messages_1.Messages.StrictReservedWord);
								}
								if (!this.match("=")) {
									this.context.isAssignmentTarget = false;
									this.context.isBindingElement = false;
								} else this.reinterpretExpressionAsPattern(expr);
								token = this.nextToken();
								var operator = token.value;
								var right = this.isolateCoverGrammar(this.parseAssignmentExpression);
								expr = this.finalize(this.startNode(startToken), new Node.AssignmentExpression(operator, expr, right));
								this.context.firstCoverInitializedNameError = null;
							}
						}
						return expr;
					};
					Parser.prototype.parseExpression = function() {
						var startToken = this.lookahead;
						var expr = this.isolateCoverGrammar(this.parseAssignmentExpression);
						if (this.match(",")) {
							var expressions = [];
							expressions.push(expr);
							while (this.lookahead.type !== 2) {
								if (!this.match(",")) break;
								this.nextToken();
								expressions.push(this.isolateCoverGrammar(this.parseAssignmentExpression));
							}
							expr = this.finalize(this.startNode(startToken), new Node.SequenceExpression(expressions));
						}
						return expr;
					};
					Parser.prototype.parseStatementListItem = function() {
						var statement;
						this.context.isAssignmentTarget = true;
						this.context.isBindingElement = true;
						if (this.lookahead.type === 4) switch (this.lookahead.value) {
							case "export":
								if (!this.context.isModule) this.tolerateUnexpectedToken(this.lookahead, messages_1.Messages.IllegalExportDeclaration);
								statement = this.parseExportDeclaration();
								break;
							case "import":
								if (!this.context.isModule) this.tolerateUnexpectedToken(this.lookahead, messages_1.Messages.IllegalImportDeclaration);
								statement = this.parseImportDeclaration();
								break;
							case "const":
								statement = this.parseLexicalDeclaration({ inFor: false });
								break;
							case "function":
								statement = this.parseFunctionDeclaration();
								break;
							case "class":
								statement = this.parseClassDeclaration();
								break;
							case "let":
								statement = this.isLexicalDeclaration() ? this.parseLexicalDeclaration({ inFor: false }) : this.parseStatement();
								break;
							default: statement = this.parseStatement();
						}
						else statement = this.parseStatement();
						return statement;
					};
					Parser.prototype.parseBlock = function() {
						var node = this.createNode();
						this.expect("{");
						var block = [];
						while (true) {
							if (this.match("}")) break;
							block.push(this.parseStatementListItem());
						}
						this.expect("}");
						return this.finalize(node, new Node.BlockStatement(block));
					};
					Parser.prototype.parseLexicalBinding = function(kind, options) {
						var node = this.createNode();
						var id = this.parsePattern([], kind);
						if (this.context.strict && id.type === syntax_1.Syntax.Identifier) {
							if (this.scanner.isRestrictedWord(id.name)) this.tolerateError(messages_1.Messages.StrictVarName);
						}
						var init = null;
						if (kind === "const") {
							if (!this.matchKeyword("in") && !this.matchContextualKeyword("of")) {
								if (this.match("=")) {
									this.nextToken();
									init = this.isolateCoverGrammar(this.parseAssignmentExpression);
								} else this.throwError(messages_1.Messages.DeclarationMissingInitializer, "const");
							}
						} else if (!options.inFor && id.type !== syntax_1.Syntax.Identifier || this.match("=")) {
							this.expect("=");
							init = this.isolateCoverGrammar(this.parseAssignmentExpression);
						}
						return this.finalize(node, new Node.VariableDeclarator(id, init));
					};
					Parser.prototype.parseBindingList = function(kind, options) {
						var list = [this.parseLexicalBinding(kind, options)];
						while (this.match(",")) {
							this.nextToken();
							list.push(this.parseLexicalBinding(kind, options));
						}
						return list;
					};
					Parser.prototype.isLexicalDeclaration = function() {
						var state = this.scanner.saveState();
						this.scanner.scanComments();
						var next = this.scanner.lex();
						this.scanner.restoreState(state);
						return next.type === 3 || next.type === 7 && next.value === "[" || next.type === 7 && next.value === "{" || next.type === 4 && next.value === "let" || next.type === 4 && next.value === "yield";
					};
					Parser.prototype.parseLexicalDeclaration = function(options) {
						var node = this.createNode();
						var kind = this.nextToken().value;
						assert_1.assert(kind === "let" || kind === "const", "Lexical declaration must be either let or const");
						var declarations = this.parseBindingList(kind, options);
						this.consumeSemicolon();
						return this.finalize(node, new Node.VariableDeclaration(declarations, kind));
					};
					Parser.prototype.parseBindingRestElement = function(params, kind) {
						var node = this.createNode();
						this.expect("...");
						var arg = this.parsePattern(params, kind);
						return this.finalize(node, new Node.RestElement(arg));
					};
					Parser.prototype.parseArrayPattern = function(params, kind) {
						var node = this.createNode();
						this.expect("[");
						var elements = [];
						while (!this.match("]")) if (this.match(",")) {
							this.nextToken();
							elements.push(null);
						} else {
							if (this.match("...")) {
								elements.push(this.parseBindingRestElement(params, kind));
								break;
							} else elements.push(this.parsePatternWithDefault(params, kind));
							if (!this.match("]")) this.expect(",");
						}
						this.expect("]");
						return this.finalize(node, new Node.ArrayPattern(elements));
					};
					Parser.prototype.parsePropertyPattern = function(params, kind) {
						var node = this.createNode();
						var computed = false;
						var shorthand = false;
						var method = false;
						var key;
						var value;
						if (this.lookahead.type === 3) {
							var keyToken = this.lookahead;
							key = this.parseVariableIdentifier();
							var init = this.finalize(node, new Node.Identifier(keyToken.value));
							if (this.match("=")) {
								params.push(keyToken);
								shorthand = true;
								this.nextToken();
								var expr = this.parseAssignmentExpression();
								value = this.finalize(this.startNode(keyToken), new Node.AssignmentPattern(init, expr));
							} else if (!this.match(":")) {
								params.push(keyToken);
								shorthand = true;
								value = init;
							} else {
								this.expect(":");
								value = this.parsePatternWithDefault(params, kind);
							}
						} else {
							computed = this.match("[");
							key = this.parseObjectPropertyKey();
							this.expect(":");
							value = this.parsePatternWithDefault(params, kind);
						}
						return this.finalize(node, new Node.Property("init", key, computed, value, method, shorthand));
					};
					Parser.prototype.parseObjectPattern = function(params, kind) {
						var node = this.createNode();
						var properties = [];
						this.expect("{");
						while (!this.match("}")) {
							properties.push(this.parsePropertyPattern(params, kind));
							if (!this.match("}")) this.expect(",");
						}
						this.expect("}");
						return this.finalize(node, new Node.ObjectPattern(properties));
					};
					Parser.prototype.parsePattern = function(params, kind) {
						var pattern;
						if (this.match("[")) pattern = this.parseArrayPattern(params, kind);
						else if (this.match("{")) pattern = this.parseObjectPattern(params, kind);
						else {
							if (this.matchKeyword("let") && (kind === "const" || kind === "let")) this.tolerateUnexpectedToken(this.lookahead, messages_1.Messages.LetInLexicalBinding);
							params.push(this.lookahead);
							pattern = this.parseVariableIdentifier(kind);
						}
						return pattern;
					};
					Parser.prototype.parsePatternWithDefault = function(params, kind) {
						var startToken = this.lookahead;
						var pattern = this.parsePattern(params, kind);
						if (this.match("=")) {
							this.nextToken();
							var previousAllowYield = this.context.allowYield;
							this.context.allowYield = true;
							var right = this.isolateCoverGrammar(this.parseAssignmentExpression);
							this.context.allowYield = previousAllowYield;
							pattern = this.finalize(this.startNode(startToken), new Node.AssignmentPattern(pattern, right));
						}
						return pattern;
					};
					Parser.prototype.parseVariableIdentifier = function(kind) {
						var node = this.createNode();
						var token = this.nextToken();
						if (token.type === 4 && token.value === "yield") {
							if (this.context.strict) this.tolerateUnexpectedToken(token, messages_1.Messages.StrictReservedWord);
							else if (!this.context.allowYield) this.throwUnexpectedToken(token);
						} else if (token.type !== 3) {
							if (this.context.strict && token.type === 4 && this.scanner.isStrictModeReservedWord(token.value)) this.tolerateUnexpectedToken(token, messages_1.Messages.StrictReservedWord);
							else if (this.context.strict || token.value !== "let" || kind !== "var") this.throwUnexpectedToken(token);
						} else if ((this.context.isModule || this.context.await) && token.type === 3 && token.value === "await") this.tolerateUnexpectedToken(token);
						return this.finalize(node, new Node.Identifier(token.value));
					};
					Parser.prototype.parseVariableDeclaration = function(options) {
						var node = this.createNode();
						var id = this.parsePattern([], "var");
						if (this.context.strict && id.type === syntax_1.Syntax.Identifier) {
							if (this.scanner.isRestrictedWord(id.name)) this.tolerateError(messages_1.Messages.StrictVarName);
						}
						var init = null;
						if (this.match("=")) {
							this.nextToken();
							init = this.isolateCoverGrammar(this.parseAssignmentExpression);
						} else if (id.type !== syntax_1.Syntax.Identifier && !options.inFor) this.expect("=");
						return this.finalize(node, new Node.VariableDeclarator(id, init));
					};
					Parser.prototype.parseVariableDeclarationList = function(options) {
						var opt = { inFor: options.inFor };
						var list = [];
						list.push(this.parseVariableDeclaration(opt));
						while (this.match(",")) {
							this.nextToken();
							list.push(this.parseVariableDeclaration(opt));
						}
						return list;
					};
					Parser.prototype.parseVariableStatement = function() {
						var node = this.createNode();
						this.expectKeyword("var");
						var declarations = this.parseVariableDeclarationList({ inFor: false });
						this.consumeSemicolon();
						return this.finalize(node, new Node.VariableDeclaration(declarations, "var"));
					};
					Parser.prototype.parseEmptyStatement = function() {
						var node = this.createNode();
						this.expect(";");
						return this.finalize(node, new Node.EmptyStatement());
					};
					Parser.prototype.parseExpressionStatement = function() {
						var node = this.createNode();
						var expr = this.parseExpression();
						this.consumeSemicolon();
						return this.finalize(node, new Node.ExpressionStatement(expr));
					};
					Parser.prototype.parseIfClause = function() {
						if (this.context.strict && this.matchKeyword("function")) this.tolerateError(messages_1.Messages.StrictFunction);
						return this.parseStatement();
					};
					Parser.prototype.parseIfStatement = function() {
						var node = this.createNode();
						var consequent;
						var alternate = null;
						this.expectKeyword("if");
						this.expect("(");
						var test = this.parseExpression();
						if (!this.match(")") && this.config.tolerant) {
							this.tolerateUnexpectedToken(this.nextToken());
							consequent = this.finalize(this.createNode(), new Node.EmptyStatement());
						} else {
							this.expect(")");
							consequent = this.parseIfClause();
							if (this.matchKeyword("else")) {
								this.nextToken();
								alternate = this.parseIfClause();
							}
						}
						return this.finalize(node, new Node.IfStatement(test, consequent, alternate));
					};
					Parser.prototype.parseDoWhileStatement = function() {
						var node = this.createNode();
						this.expectKeyword("do");
						var previousInIteration = this.context.inIteration;
						this.context.inIteration = true;
						var body = this.parseStatement();
						this.context.inIteration = previousInIteration;
						this.expectKeyword("while");
						this.expect("(");
						var test = this.parseExpression();
						if (!this.match(")") && this.config.tolerant) this.tolerateUnexpectedToken(this.nextToken());
						else {
							this.expect(")");
							if (this.match(";")) this.nextToken();
						}
						return this.finalize(node, new Node.DoWhileStatement(body, test));
					};
					Parser.prototype.parseWhileStatement = function() {
						var node = this.createNode();
						var body;
						this.expectKeyword("while");
						this.expect("(");
						var test = this.parseExpression();
						if (!this.match(")") && this.config.tolerant) {
							this.tolerateUnexpectedToken(this.nextToken());
							body = this.finalize(this.createNode(), new Node.EmptyStatement());
						} else {
							this.expect(")");
							var previousInIteration = this.context.inIteration;
							this.context.inIteration = true;
							body = this.parseStatement();
							this.context.inIteration = previousInIteration;
						}
						return this.finalize(node, new Node.WhileStatement(test, body));
					};
					Parser.prototype.parseForStatement = function() {
						var init = null;
						var test = null;
						var update = null;
						var forIn = true;
						var left, right;
						var node = this.createNode();
						this.expectKeyword("for");
						this.expect("(");
						if (this.match(";")) this.nextToken();
						else if (this.matchKeyword("var")) {
							init = this.createNode();
							this.nextToken();
							var previousAllowIn = this.context.allowIn;
							this.context.allowIn = false;
							var declarations = this.parseVariableDeclarationList({ inFor: true });
							this.context.allowIn = previousAllowIn;
							if (declarations.length === 1 && this.matchKeyword("in")) {
								var decl = declarations[0];
								if (decl.init && (decl.id.type === syntax_1.Syntax.ArrayPattern || decl.id.type === syntax_1.Syntax.ObjectPattern || this.context.strict)) this.tolerateError(messages_1.Messages.ForInOfLoopInitializer, "for-in");
								init = this.finalize(init, new Node.VariableDeclaration(declarations, "var"));
								this.nextToken();
								left = init;
								right = this.parseExpression();
								init = null;
							} else if (declarations.length === 1 && declarations[0].init === null && this.matchContextualKeyword("of")) {
								init = this.finalize(init, new Node.VariableDeclaration(declarations, "var"));
								this.nextToken();
								left = init;
								right = this.parseAssignmentExpression();
								init = null;
								forIn = false;
							} else {
								init = this.finalize(init, new Node.VariableDeclaration(declarations, "var"));
								this.expect(";");
							}
						} else if (this.matchKeyword("const") || this.matchKeyword("let")) {
							init = this.createNode();
							var kind = this.nextToken().value;
							if (!this.context.strict && this.lookahead.value === "in") {
								init = this.finalize(init, new Node.Identifier(kind));
								this.nextToken();
								left = init;
								right = this.parseExpression();
								init = null;
							} else {
								var previousAllowIn = this.context.allowIn;
								this.context.allowIn = false;
								var declarations = this.parseBindingList(kind, { inFor: true });
								this.context.allowIn = previousAllowIn;
								if (declarations.length === 1 && declarations[0].init === null && this.matchKeyword("in")) {
									init = this.finalize(init, new Node.VariableDeclaration(declarations, kind));
									this.nextToken();
									left = init;
									right = this.parseExpression();
									init = null;
								} else if (declarations.length === 1 && declarations[0].init === null && this.matchContextualKeyword("of")) {
									init = this.finalize(init, new Node.VariableDeclaration(declarations, kind));
									this.nextToken();
									left = init;
									right = this.parseAssignmentExpression();
									init = null;
									forIn = false;
								} else {
									this.consumeSemicolon();
									init = this.finalize(init, new Node.VariableDeclaration(declarations, kind));
								}
							}
						} else {
							var initStartToken = this.lookahead;
							var previousAllowIn = this.context.allowIn;
							this.context.allowIn = false;
							init = this.inheritCoverGrammar(this.parseAssignmentExpression);
							this.context.allowIn = previousAllowIn;
							if (this.matchKeyword("in")) {
								if (!this.context.isAssignmentTarget || init.type === syntax_1.Syntax.AssignmentExpression) this.tolerateError(messages_1.Messages.InvalidLHSInForIn);
								this.nextToken();
								this.reinterpretExpressionAsPattern(init);
								left = init;
								right = this.parseExpression();
								init = null;
							} else if (this.matchContextualKeyword("of")) {
								if (!this.context.isAssignmentTarget || init.type === syntax_1.Syntax.AssignmentExpression) this.tolerateError(messages_1.Messages.InvalidLHSInForLoop);
								this.nextToken();
								this.reinterpretExpressionAsPattern(init);
								left = init;
								right = this.parseAssignmentExpression();
								init = null;
								forIn = false;
							} else {
								if (this.match(",")) {
									var initSeq = [init];
									while (this.match(",")) {
										this.nextToken();
										initSeq.push(this.isolateCoverGrammar(this.parseAssignmentExpression));
									}
									init = this.finalize(this.startNode(initStartToken), new Node.SequenceExpression(initSeq));
								}
								this.expect(";");
							}
						}
						if (typeof left === "undefined") {
							if (!this.match(";")) test = this.parseExpression();
							this.expect(";");
							if (!this.match(")")) update = this.parseExpression();
						}
						var body;
						if (!this.match(")") && this.config.tolerant) {
							this.tolerateUnexpectedToken(this.nextToken());
							body = this.finalize(this.createNode(), new Node.EmptyStatement());
						} else {
							this.expect(")");
							var previousInIteration = this.context.inIteration;
							this.context.inIteration = true;
							body = this.isolateCoverGrammar(this.parseStatement);
							this.context.inIteration = previousInIteration;
						}
						return typeof left === "undefined" ? this.finalize(node, new Node.ForStatement(init, test, update, body)) : forIn ? this.finalize(node, new Node.ForInStatement(left, right, body)) : this.finalize(node, new Node.ForOfStatement(left, right, body));
					};
					Parser.prototype.parseContinueStatement = function() {
						var node = this.createNode();
						this.expectKeyword("continue");
						var label = null;
						if (this.lookahead.type === 3 && !this.hasLineTerminator) {
							var id = this.parseVariableIdentifier();
							label = id;
							var key = "$" + id.name;
							if (!Object.prototype.hasOwnProperty.call(this.context.labelSet, key)) this.throwError(messages_1.Messages.UnknownLabel, id.name);
						}
						this.consumeSemicolon();
						if (label === null && !this.context.inIteration) this.throwError(messages_1.Messages.IllegalContinue);
						return this.finalize(node, new Node.ContinueStatement(label));
					};
					Parser.prototype.parseBreakStatement = function() {
						var node = this.createNode();
						this.expectKeyword("break");
						var label = null;
						if (this.lookahead.type === 3 && !this.hasLineTerminator) {
							var id = this.parseVariableIdentifier();
							var key = "$" + id.name;
							if (!Object.prototype.hasOwnProperty.call(this.context.labelSet, key)) this.throwError(messages_1.Messages.UnknownLabel, id.name);
							label = id;
						}
						this.consumeSemicolon();
						if (label === null && !this.context.inIteration && !this.context.inSwitch) this.throwError(messages_1.Messages.IllegalBreak);
						return this.finalize(node, new Node.BreakStatement(label));
					};
					Parser.prototype.parseReturnStatement = function() {
						if (!this.context.inFunctionBody) this.tolerateError(messages_1.Messages.IllegalReturn);
						var node = this.createNode();
						this.expectKeyword("return");
						var argument = !this.match(";") && !this.match("}") && !this.hasLineTerminator && this.lookahead.type !== 2 || this.lookahead.type === 8 || this.lookahead.type === 10 ? this.parseExpression() : null;
						this.consumeSemicolon();
						return this.finalize(node, new Node.ReturnStatement(argument));
					};
					Parser.prototype.parseWithStatement = function() {
						if (this.context.strict) this.tolerateError(messages_1.Messages.StrictModeWith);
						var node = this.createNode();
						var body;
						this.expectKeyword("with");
						this.expect("(");
						var object = this.parseExpression();
						if (!this.match(")") && this.config.tolerant) {
							this.tolerateUnexpectedToken(this.nextToken());
							body = this.finalize(this.createNode(), new Node.EmptyStatement());
						} else {
							this.expect(")");
							body = this.parseStatement();
						}
						return this.finalize(node, new Node.WithStatement(object, body));
					};
					Parser.prototype.parseSwitchCase = function() {
						var node = this.createNode();
						var test;
						if (this.matchKeyword("default")) {
							this.nextToken();
							test = null;
						} else {
							this.expectKeyword("case");
							test = this.parseExpression();
						}
						this.expect(":");
						var consequent = [];
						while (true) {
							if (this.match("}") || this.matchKeyword("default") || this.matchKeyword("case")) break;
							consequent.push(this.parseStatementListItem());
						}
						return this.finalize(node, new Node.SwitchCase(test, consequent));
					};
					Parser.prototype.parseSwitchStatement = function() {
						var node = this.createNode();
						this.expectKeyword("switch");
						this.expect("(");
						var discriminant = this.parseExpression();
						this.expect(")");
						var previousInSwitch = this.context.inSwitch;
						this.context.inSwitch = true;
						var cases = [];
						var defaultFound = false;
						this.expect("{");
						while (true) {
							if (this.match("}")) break;
							var clause = this.parseSwitchCase();
							if (clause.test === null) {
								if (defaultFound) this.throwError(messages_1.Messages.MultipleDefaultsInSwitch);
								defaultFound = true;
							}
							cases.push(clause);
						}
						this.expect("}");
						this.context.inSwitch = previousInSwitch;
						return this.finalize(node, new Node.SwitchStatement(discriminant, cases));
					};
					Parser.prototype.parseLabelledStatement = function() {
						var node = this.createNode();
						var expr = this.parseExpression();
						var statement;
						if (expr.type === syntax_1.Syntax.Identifier && this.match(":")) {
							this.nextToken();
							var id = expr;
							var key = "$" + id.name;
							if (Object.prototype.hasOwnProperty.call(this.context.labelSet, key)) this.throwError(messages_1.Messages.Redeclaration, "Label", id.name);
							this.context.labelSet[key] = true;
							var body = void 0;
							if (this.matchKeyword("class")) {
								this.tolerateUnexpectedToken(this.lookahead);
								body = this.parseClassDeclaration();
							} else if (this.matchKeyword("function")) {
								var token = this.lookahead;
								var declaration = this.parseFunctionDeclaration();
								if (this.context.strict) this.tolerateUnexpectedToken(token, messages_1.Messages.StrictFunction);
								else if (declaration.generator) this.tolerateUnexpectedToken(token, messages_1.Messages.GeneratorInLegacyContext);
								body = declaration;
							} else body = this.parseStatement();
							delete this.context.labelSet[key];
							statement = new Node.LabeledStatement(id, body);
						} else {
							this.consumeSemicolon();
							statement = new Node.ExpressionStatement(expr);
						}
						return this.finalize(node, statement);
					};
					Parser.prototype.parseThrowStatement = function() {
						var node = this.createNode();
						this.expectKeyword("throw");
						if (this.hasLineTerminator) this.throwError(messages_1.Messages.NewlineAfterThrow);
						var argument = this.parseExpression();
						this.consumeSemicolon();
						return this.finalize(node, new Node.ThrowStatement(argument));
					};
					Parser.prototype.parseCatchClause = function() {
						var node = this.createNode();
						this.expectKeyword("catch");
						this.expect("(");
						if (this.match(")")) this.throwUnexpectedToken(this.lookahead);
						var params = [];
						var param = this.parsePattern(params);
						var paramMap = {};
						for (var i = 0; i < params.length; i++) {
							var key = "$" + params[i].value;
							if (Object.prototype.hasOwnProperty.call(paramMap, key)) this.tolerateError(messages_1.Messages.DuplicateBinding, params[i].value);
							paramMap[key] = true;
						}
						if (this.context.strict && param.type === syntax_1.Syntax.Identifier) {
							if (this.scanner.isRestrictedWord(param.name)) this.tolerateError(messages_1.Messages.StrictCatchVariable);
						}
						this.expect(")");
						var body = this.parseBlock();
						return this.finalize(node, new Node.CatchClause(param, body));
					};
					Parser.prototype.parseFinallyClause = function() {
						this.expectKeyword("finally");
						return this.parseBlock();
					};
					Parser.prototype.parseTryStatement = function() {
						var node = this.createNode();
						this.expectKeyword("try");
						var block = this.parseBlock();
						var handler = this.matchKeyword("catch") ? this.parseCatchClause() : null;
						var finalizer = this.matchKeyword("finally") ? this.parseFinallyClause() : null;
						if (!handler && !finalizer) this.throwError(messages_1.Messages.NoCatchOrFinally);
						return this.finalize(node, new Node.TryStatement(block, handler, finalizer));
					};
					Parser.prototype.parseDebuggerStatement = function() {
						var node = this.createNode();
						this.expectKeyword("debugger");
						this.consumeSemicolon();
						return this.finalize(node, new Node.DebuggerStatement());
					};
					Parser.prototype.parseStatement = function() {
						var statement;
						switch (this.lookahead.type) {
							case 1:
							case 5:
							case 6:
							case 8:
							case 10:
							case 9:
								statement = this.parseExpressionStatement();
								break;
							case 7:
								var value = this.lookahead.value;
								if (value === "{") statement = this.parseBlock();
								else if (value === "(") statement = this.parseExpressionStatement();
								else if (value === ";") statement = this.parseEmptyStatement();
								else statement = this.parseExpressionStatement();
								break;
							case 3:
								statement = this.matchAsyncFunction() ? this.parseFunctionDeclaration() : this.parseLabelledStatement();
								break;
							case 4:
								switch (this.lookahead.value) {
									case "break":
										statement = this.parseBreakStatement();
										break;
									case "continue":
										statement = this.parseContinueStatement();
										break;
									case "debugger":
										statement = this.parseDebuggerStatement();
										break;
									case "do":
										statement = this.parseDoWhileStatement();
										break;
									case "for":
										statement = this.parseForStatement();
										break;
									case "function":
										statement = this.parseFunctionDeclaration();
										break;
									case "if":
										statement = this.parseIfStatement();
										break;
									case "return":
										statement = this.parseReturnStatement();
										break;
									case "switch":
										statement = this.parseSwitchStatement();
										break;
									case "throw":
										statement = this.parseThrowStatement();
										break;
									case "try":
										statement = this.parseTryStatement();
										break;
									case "var":
										statement = this.parseVariableStatement();
										break;
									case "while":
										statement = this.parseWhileStatement();
										break;
									case "with":
										statement = this.parseWithStatement();
										break;
									default: statement = this.parseExpressionStatement();
								}
								break;
							default: statement = this.throwUnexpectedToken(this.lookahead);
						}
						return statement;
					};
					Parser.prototype.parseFunctionSourceElements = function() {
						var node = this.createNode();
						this.expect("{");
						var body = this.parseDirectivePrologues();
						var previousLabelSet = this.context.labelSet;
						var previousInIteration = this.context.inIteration;
						var previousInSwitch = this.context.inSwitch;
						var previousInFunctionBody = this.context.inFunctionBody;
						this.context.labelSet = {};
						this.context.inIteration = false;
						this.context.inSwitch = false;
						this.context.inFunctionBody = true;
						while (this.lookahead.type !== 2) {
							if (this.match("}")) break;
							body.push(this.parseStatementListItem());
						}
						this.expect("}");
						this.context.labelSet = previousLabelSet;
						this.context.inIteration = previousInIteration;
						this.context.inSwitch = previousInSwitch;
						this.context.inFunctionBody = previousInFunctionBody;
						return this.finalize(node, new Node.BlockStatement(body));
					};
					Parser.prototype.validateParam = function(options, param, name) {
						var key = "$" + name;
						if (this.context.strict) {
							if (this.scanner.isRestrictedWord(name)) {
								options.stricted = param;
								options.message = messages_1.Messages.StrictParamName;
							}
							if (Object.prototype.hasOwnProperty.call(options.paramSet, key)) {
								options.stricted = param;
								options.message = messages_1.Messages.StrictParamDupe;
							}
						} else if (!options.firstRestricted) {
							if (this.scanner.isRestrictedWord(name)) {
								options.firstRestricted = param;
								options.message = messages_1.Messages.StrictParamName;
							} else if (this.scanner.isStrictModeReservedWord(name)) {
								options.firstRestricted = param;
								options.message = messages_1.Messages.StrictReservedWord;
							} else if (Object.prototype.hasOwnProperty.call(options.paramSet, key)) {
								options.stricted = param;
								options.message = messages_1.Messages.StrictParamDupe;
							}
						}
						/* istanbul ignore next */
						if (typeof Object.defineProperty === "function") Object.defineProperty(options.paramSet, key, {
							value: true,
							enumerable: true,
							writable: true,
							configurable: true
						});
						else options.paramSet[key] = true;
					};
					Parser.prototype.parseRestElement = function(params) {
						var node = this.createNode();
						this.expect("...");
						var arg = this.parsePattern(params);
						if (this.match("=")) this.throwError(messages_1.Messages.DefaultRestParameter);
						if (!this.match(")")) this.throwError(messages_1.Messages.ParameterAfterRestParameter);
						return this.finalize(node, new Node.RestElement(arg));
					};
					Parser.prototype.parseFormalParameter = function(options) {
						var params = [];
						var param = this.match("...") ? this.parseRestElement(params) : this.parsePatternWithDefault(params);
						for (var i = 0; i < params.length; i++) this.validateParam(options, params[i], params[i].value);
						options.simple = options.simple && param instanceof Node.Identifier;
						options.params.push(param);
					};
					Parser.prototype.parseFormalParameters = function(firstRestricted) {
						var options = {
							simple: true,
							params: [],
							firstRestricted
						};
						this.expect("(");
						if (!this.match(")")) {
							options.paramSet = {};
							while (this.lookahead.type !== 2) {
								this.parseFormalParameter(options);
								if (this.match(")")) break;
								this.expect(",");
								if (this.match(")")) break;
							}
						}
						this.expect(")");
						return {
							simple: options.simple,
							params: options.params,
							stricted: options.stricted,
							firstRestricted: options.firstRestricted,
							message: options.message
						};
					};
					Parser.prototype.matchAsyncFunction = function() {
						var match = this.matchContextualKeyword("async");
						if (match) {
							var state = this.scanner.saveState();
							this.scanner.scanComments();
							var next = this.scanner.lex();
							this.scanner.restoreState(state);
							match = state.lineNumber === next.lineNumber && next.type === 4 && next.value === "function";
						}
						return match;
					};
					Parser.prototype.parseFunctionDeclaration = function(identifierIsOptional) {
						var node = this.createNode();
						var isAsync = this.matchContextualKeyword("async");
						if (isAsync) this.nextToken();
						this.expectKeyword("function");
						var isGenerator = isAsync ? false : this.match("*");
						if (isGenerator) this.nextToken();
						var message;
						var id = null;
						var firstRestricted = null;
						if (!identifierIsOptional || !this.match("(")) {
							var token = this.lookahead;
							id = this.parseVariableIdentifier();
							if (this.context.strict) {
								if (this.scanner.isRestrictedWord(token.value)) this.tolerateUnexpectedToken(token, messages_1.Messages.StrictFunctionName);
							} else if (this.scanner.isRestrictedWord(token.value)) {
								firstRestricted = token;
								message = messages_1.Messages.StrictFunctionName;
							} else if (this.scanner.isStrictModeReservedWord(token.value)) {
								firstRestricted = token;
								message = messages_1.Messages.StrictReservedWord;
							}
						}
						var previousAllowAwait = this.context.await;
						var previousAllowYield = this.context.allowYield;
						this.context.await = isAsync;
						this.context.allowYield = !isGenerator;
						var formalParameters = this.parseFormalParameters(firstRestricted);
						var params = formalParameters.params;
						var stricted = formalParameters.stricted;
						firstRestricted = formalParameters.firstRestricted;
						if (formalParameters.message) message = formalParameters.message;
						var previousStrict = this.context.strict;
						var previousAllowStrictDirective = this.context.allowStrictDirective;
						this.context.allowStrictDirective = formalParameters.simple;
						var body = this.parseFunctionSourceElements();
						if (this.context.strict && firstRestricted) this.throwUnexpectedToken(firstRestricted, message);
						if (this.context.strict && stricted) this.tolerateUnexpectedToken(stricted, message);
						this.context.strict = previousStrict;
						this.context.allowStrictDirective = previousAllowStrictDirective;
						this.context.await = previousAllowAwait;
						this.context.allowYield = previousAllowYield;
						return isAsync ? this.finalize(node, new Node.AsyncFunctionDeclaration(id, params, body)) : this.finalize(node, new Node.FunctionDeclaration(id, params, body, isGenerator));
					};
					Parser.prototype.parseFunctionExpression = function() {
						var node = this.createNode();
						var isAsync = this.matchContextualKeyword("async");
						if (isAsync) this.nextToken();
						this.expectKeyword("function");
						var isGenerator = isAsync ? false : this.match("*");
						if (isGenerator) this.nextToken();
						var message;
						var id = null;
						var firstRestricted;
						var previousAllowAwait = this.context.await;
						var previousAllowYield = this.context.allowYield;
						this.context.await = isAsync;
						this.context.allowYield = !isGenerator;
						if (!this.match("(")) {
							var token = this.lookahead;
							id = !this.context.strict && !isGenerator && this.matchKeyword("yield") ? this.parseIdentifierName() : this.parseVariableIdentifier();
							if (this.context.strict) {
								if (this.scanner.isRestrictedWord(token.value)) this.tolerateUnexpectedToken(token, messages_1.Messages.StrictFunctionName);
							} else if (this.scanner.isRestrictedWord(token.value)) {
								firstRestricted = token;
								message = messages_1.Messages.StrictFunctionName;
							} else if (this.scanner.isStrictModeReservedWord(token.value)) {
								firstRestricted = token;
								message = messages_1.Messages.StrictReservedWord;
							}
						}
						var formalParameters = this.parseFormalParameters(firstRestricted);
						var params = formalParameters.params;
						var stricted = formalParameters.stricted;
						firstRestricted = formalParameters.firstRestricted;
						if (formalParameters.message) message = formalParameters.message;
						var previousStrict = this.context.strict;
						var previousAllowStrictDirective = this.context.allowStrictDirective;
						this.context.allowStrictDirective = formalParameters.simple;
						var body = this.parseFunctionSourceElements();
						if (this.context.strict && firstRestricted) this.throwUnexpectedToken(firstRestricted, message);
						if (this.context.strict && stricted) this.tolerateUnexpectedToken(stricted, message);
						this.context.strict = previousStrict;
						this.context.allowStrictDirective = previousAllowStrictDirective;
						this.context.await = previousAllowAwait;
						this.context.allowYield = previousAllowYield;
						return isAsync ? this.finalize(node, new Node.AsyncFunctionExpression(id, params, body)) : this.finalize(node, new Node.FunctionExpression(id, params, body, isGenerator));
					};
					Parser.prototype.parseDirective = function() {
						var token = this.lookahead;
						var node = this.createNode();
						var expr = this.parseExpression();
						var directive = expr.type === syntax_1.Syntax.Literal ? this.getTokenRaw(token).slice(1, -1) : null;
						this.consumeSemicolon();
						return this.finalize(node, directive ? new Node.Directive(expr, directive) : new Node.ExpressionStatement(expr));
					};
					Parser.prototype.parseDirectivePrologues = function() {
						var firstRestricted = null;
						var body = [];
						while (true) {
							var token = this.lookahead;
							if (token.type !== 8) break;
							var statement = this.parseDirective();
							body.push(statement);
							var directive = statement.directive;
							if (typeof directive !== "string") break;
							if (directive === "use strict") {
								this.context.strict = true;
								if (firstRestricted) this.tolerateUnexpectedToken(firstRestricted, messages_1.Messages.StrictOctalLiteral);
								if (!this.context.allowStrictDirective) this.tolerateUnexpectedToken(token, messages_1.Messages.IllegalLanguageModeDirective);
							} else if (!firstRestricted && token.octal) firstRestricted = token;
						}
						return body;
					};
					Parser.prototype.qualifiedPropertyName = function(token) {
						switch (token.type) {
							case 3:
							case 8:
							case 1:
							case 5:
							case 6:
							case 4: return true;
							case 7: return token.value === "[";
						}
						return false;
					};
					Parser.prototype.parseGetterMethod = function() {
						var node = this.createNode();
						var isGenerator = false;
						var previousAllowYield = this.context.allowYield;
						this.context.allowYield = !isGenerator;
						var formalParameters = this.parseFormalParameters();
						if (formalParameters.params.length > 0) this.tolerateError(messages_1.Messages.BadGetterArity);
						var method = this.parsePropertyMethod(formalParameters);
						this.context.allowYield = previousAllowYield;
						return this.finalize(node, new Node.FunctionExpression(null, formalParameters.params, method, isGenerator));
					};
					Parser.prototype.parseSetterMethod = function() {
						var node = this.createNode();
						var isGenerator = false;
						var previousAllowYield = this.context.allowYield;
						this.context.allowYield = !isGenerator;
						var formalParameters = this.parseFormalParameters();
						if (formalParameters.params.length !== 1) this.tolerateError(messages_1.Messages.BadSetterArity);
						else if (formalParameters.params[0] instanceof Node.RestElement) this.tolerateError(messages_1.Messages.BadSetterRestParameter);
						var method = this.parsePropertyMethod(formalParameters);
						this.context.allowYield = previousAllowYield;
						return this.finalize(node, new Node.FunctionExpression(null, formalParameters.params, method, isGenerator));
					};
					Parser.prototype.parseGeneratorMethod = function() {
						var node = this.createNode();
						var isGenerator = true;
						var previousAllowYield = this.context.allowYield;
						this.context.allowYield = true;
						var params = this.parseFormalParameters();
						this.context.allowYield = false;
						var method = this.parsePropertyMethod(params);
						this.context.allowYield = previousAllowYield;
						return this.finalize(node, new Node.FunctionExpression(null, params.params, method, isGenerator));
					};
					Parser.prototype.isStartOfExpression = function() {
						var start = true;
						var value = this.lookahead.value;
						switch (this.lookahead.type) {
							case 7:
								start = value === "[" || value === "(" || value === "{" || value === "+" || value === "-" || value === "!" || value === "~" || value === "++" || value === "--" || value === "/" || value === "/=";
								break;
							case 4: start = value === "class" || value === "delete" || value === "function" || value === "let" || value === "new" || value === "super" || value === "this" || value === "typeof" || value === "void" || value === "yield";
						}
						return start;
					};
					Parser.prototype.parseYieldExpression = function() {
						var node = this.createNode();
						this.expectKeyword("yield");
						var argument = null;
						var delegate = false;
						if (!this.hasLineTerminator) {
							var previousAllowYield = this.context.allowYield;
							this.context.allowYield = false;
							delegate = this.match("*");
							if (delegate) {
								this.nextToken();
								argument = this.parseAssignmentExpression();
							} else if (this.isStartOfExpression()) argument = this.parseAssignmentExpression();
							this.context.allowYield = previousAllowYield;
						}
						return this.finalize(node, new Node.YieldExpression(argument, delegate));
					};
					Parser.prototype.parseClassElement = function(hasConstructor) {
						var token = this.lookahead;
						var node = this.createNode();
						var kind = "";
						var key = null;
						var value = null;
						var computed = false;
						var method = false;
						var isStatic = false;
						var isAsync = false;
						if (this.match("*")) this.nextToken();
						else {
							computed = this.match("[");
							key = this.parseObjectPropertyKey();
							if (key.name === "static" && (this.qualifiedPropertyName(this.lookahead) || this.match("*"))) {
								token = this.lookahead;
								isStatic = true;
								computed = this.match("[");
								if (this.match("*")) this.nextToken();
								else key = this.parseObjectPropertyKey();
							}
							if (token.type === 3 && !this.hasLineTerminator && token.value === "async") {
								var punctuator = this.lookahead.value;
								if (punctuator !== ":" && punctuator !== "(" && punctuator !== "*") {
									isAsync = true;
									token = this.lookahead;
									key = this.parseObjectPropertyKey();
									if (token.type === 3 && token.value === "constructor") this.tolerateUnexpectedToken(token, messages_1.Messages.ConstructorIsAsync);
								}
							}
						}
						var lookaheadPropertyKey = this.qualifiedPropertyName(this.lookahead);
						if (token.type === 3) {
							if (token.value === "get" && lookaheadPropertyKey) {
								kind = "get";
								computed = this.match("[");
								key = this.parseObjectPropertyKey();
								this.context.allowYield = false;
								value = this.parseGetterMethod();
							} else if (token.value === "set" && lookaheadPropertyKey) {
								kind = "set";
								computed = this.match("[");
								key = this.parseObjectPropertyKey();
								value = this.parseSetterMethod();
							}
						} else if (token.type === 7 && token.value === "*" && lookaheadPropertyKey) {
							kind = "init";
							computed = this.match("[");
							key = this.parseObjectPropertyKey();
							value = this.parseGeneratorMethod();
							method = true;
						}
						if (!kind && key && this.match("(")) {
							kind = "init";
							value = isAsync ? this.parsePropertyMethodAsyncFunction() : this.parsePropertyMethodFunction();
							method = true;
						}
						if (!kind) this.throwUnexpectedToken(this.lookahead);
						if (kind === "init") kind = "method";
						if (!computed) {
							if (isStatic && this.isPropertyKey(key, "prototype")) this.throwUnexpectedToken(token, messages_1.Messages.StaticPrototype);
							if (!isStatic && this.isPropertyKey(key, "constructor")) {
								if (kind !== "method" || !method || value && value.generator) this.throwUnexpectedToken(token, messages_1.Messages.ConstructorSpecialMethod);
								if (hasConstructor.value) this.throwUnexpectedToken(token, messages_1.Messages.DuplicateConstructor);
								else hasConstructor.value = true;
								kind = "constructor";
							}
						}
						return this.finalize(node, new Node.MethodDefinition(key, computed, value, kind, isStatic));
					};
					Parser.prototype.parseClassElementList = function() {
						var body = [];
						var hasConstructor = { value: false };
						this.expect("{");
						while (!this.match("}")) if (this.match(";")) this.nextToken();
						else body.push(this.parseClassElement(hasConstructor));
						this.expect("}");
						return body;
					};
					Parser.prototype.parseClassBody = function() {
						var node = this.createNode();
						var elementList = this.parseClassElementList();
						return this.finalize(node, new Node.ClassBody(elementList));
					};
					Parser.prototype.parseClassDeclaration = function(identifierIsOptional) {
						var node = this.createNode();
						var previousStrict = this.context.strict;
						this.context.strict = true;
						this.expectKeyword("class");
						var id = identifierIsOptional && this.lookahead.type !== 3 ? null : this.parseVariableIdentifier();
						var superClass = null;
						if (this.matchKeyword("extends")) {
							this.nextToken();
							superClass = this.isolateCoverGrammar(this.parseLeftHandSideExpressionAllowCall);
						}
						var classBody = this.parseClassBody();
						this.context.strict = previousStrict;
						return this.finalize(node, new Node.ClassDeclaration(id, superClass, classBody));
					};
					Parser.prototype.parseClassExpression = function() {
						var node = this.createNode();
						var previousStrict = this.context.strict;
						this.context.strict = true;
						this.expectKeyword("class");
						var id = this.lookahead.type === 3 ? this.parseVariableIdentifier() : null;
						var superClass = null;
						if (this.matchKeyword("extends")) {
							this.nextToken();
							superClass = this.isolateCoverGrammar(this.parseLeftHandSideExpressionAllowCall);
						}
						var classBody = this.parseClassBody();
						this.context.strict = previousStrict;
						return this.finalize(node, new Node.ClassExpression(id, superClass, classBody));
					};
					Parser.prototype.parseModule = function() {
						this.context.strict = true;
						this.context.isModule = true;
						this.scanner.isModule = true;
						var node = this.createNode();
						var body = this.parseDirectivePrologues();
						while (this.lookahead.type !== 2) body.push(this.parseStatementListItem());
						return this.finalize(node, new Node.Module(body));
					};
					Parser.prototype.parseScript = function() {
						var node = this.createNode();
						var body = this.parseDirectivePrologues();
						while (this.lookahead.type !== 2) body.push(this.parseStatementListItem());
						return this.finalize(node, new Node.Script(body));
					};
					Parser.prototype.parseModuleSpecifier = function() {
						var node = this.createNode();
						if (this.lookahead.type !== 8) this.throwError(messages_1.Messages.InvalidModuleSpecifier);
						var token = this.nextToken();
						var raw = this.getTokenRaw(token);
						return this.finalize(node, new Node.Literal(token.value, raw));
					};
					Parser.prototype.parseImportSpecifier = function() {
						var node = this.createNode();
						var imported;
						var local;
						if (this.lookahead.type === 3) {
							imported = this.parseVariableIdentifier();
							local = imported;
							if (this.matchContextualKeyword("as")) {
								this.nextToken();
								local = this.parseVariableIdentifier();
							}
						} else {
							imported = this.parseIdentifierName();
							local = imported;
							if (this.matchContextualKeyword("as")) {
								this.nextToken();
								local = this.parseVariableIdentifier();
							} else this.throwUnexpectedToken(this.nextToken());
						}
						return this.finalize(node, new Node.ImportSpecifier(local, imported));
					};
					Parser.prototype.parseNamedImports = function() {
						this.expect("{");
						var specifiers = [];
						while (!this.match("}")) {
							specifiers.push(this.parseImportSpecifier());
							if (!this.match("}")) this.expect(",");
						}
						this.expect("}");
						return specifiers;
					};
					Parser.prototype.parseImportDefaultSpecifier = function() {
						var node = this.createNode();
						var local = this.parseIdentifierName();
						return this.finalize(node, new Node.ImportDefaultSpecifier(local));
					};
					Parser.prototype.parseImportNamespaceSpecifier = function() {
						var node = this.createNode();
						this.expect("*");
						if (!this.matchContextualKeyword("as")) this.throwError(messages_1.Messages.NoAsAfterImportNamespace);
						this.nextToken();
						var local = this.parseIdentifierName();
						return this.finalize(node, new Node.ImportNamespaceSpecifier(local));
					};
					Parser.prototype.parseImportDeclaration = function() {
						if (this.context.inFunctionBody) this.throwError(messages_1.Messages.IllegalImportDeclaration);
						var node = this.createNode();
						this.expectKeyword("import");
						var src;
						var specifiers = [];
						if (this.lookahead.type === 8) src = this.parseModuleSpecifier();
						else {
							if (this.match("{")) specifiers = specifiers.concat(this.parseNamedImports());
							else if (this.match("*")) specifiers.push(this.parseImportNamespaceSpecifier());
							else if (this.isIdentifierName(this.lookahead) && !this.matchKeyword("default")) {
								specifiers.push(this.parseImportDefaultSpecifier());
								if (this.match(",")) {
									this.nextToken();
									if (this.match("*")) specifiers.push(this.parseImportNamespaceSpecifier());
									else if (this.match("{")) specifiers = specifiers.concat(this.parseNamedImports());
									else this.throwUnexpectedToken(this.lookahead);
								}
							} else this.throwUnexpectedToken(this.nextToken());
							if (!this.matchContextualKeyword("from")) {
								var message = this.lookahead.value ? messages_1.Messages.UnexpectedToken : messages_1.Messages.MissingFromClause;
								this.throwError(message, this.lookahead.value);
							}
							this.nextToken();
							src = this.parseModuleSpecifier();
						}
						this.consumeSemicolon();
						return this.finalize(node, new Node.ImportDeclaration(specifiers, src));
					};
					Parser.prototype.parseExportSpecifier = function() {
						var node = this.createNode();
						var local = this.parseIdentifierName();
						var exported = local;
						if (this.matchContextualKeyword("as")) {
							this.nextToken();
							exported = this.parseIdentifierName();
						}
						return this.finalize(node, new Node.ExportSpecifier(local, exported));
					};
					Parser.prototype.parseExportDeclaration = function() {
						if (this.context.inFunctionBody) this.throwError(messages_1.Messages.IllegalExportDeclaration);
						var node = this.createNode();
						this.expectKeyword("export");
						var exportDeclaration;
						if (this.matchKeyword("default")) {
							this.nextToken();
							if (this.matchKeyword("function")) {
								var declaration = this.parseFunctionDeclaration(true);
								exportDeclaration = this.finalize(node, new Node.ExportDefaultDeclaration(declaration));
							} else if (this.matchKeyword("class")) {
								var declaration = this.parseClassDeclaration(true);
								exportDeclaration = this.finalize(node, new Node.ExportDefaultDeclaration(declaration));
							} else if (this.matchContextualKeyword("async")) {
								var declaration = this.matchAsyncFunction() ? this.parseFunctionDeclaration(true) : this.parseAssignmentExpression();
								exportDeclaration = this.finalize(node, new Node.ExportDefaultDeclaration(declaration));
							} else {
								if (this.matchContextualKeyword("from")) this.throwError(messages_1.Messages.UnexpectedToken, this.lookahead.value);
								var declaration = this.match("{") ? this.parseObjectInitializer() : this.match("[") ? this.parseArrayInitializer() : this.parseAssignmentExpression();
								this.consumeSemicolon();
								exportDeclaration = this.finalize(node, new Node.ExportDefaultDeclaration(declaration));
							}
						} else if (this.match("*")) {
							this.nextToken();
							if (!this.matchContextualKeyword("from")) {
								var message = this.lookahead.value ? messages_1.Messages.UnexpectedToken : messages_1.Messages.MissingFromClause;
								this.throwError(message, this.lookahead.value);
							}
							this.nextToken();
							var src = this.parseModuleSpecifier();
							this.consumeSemicolon();
							exportDeclaration = this.finalize(node, new Node.ExportAllDeclaration(src));
						} else if (this.lookahead.type === 4) {
							var declaration = void 0;
							switch (this.lookahead.value) {
								case "let":
								case "const":
									declaration = this.parseLexicalDeclaration({ inFor: false });
									break;
								case "var":
								case "class":
								case "function":
									declaration = this.parseStatementListItem();
									break;
								default: this.throwUnexpectedToken(this.lookahead);
							}
							exportDeclaration = this.finalize(node, new Node.ExportNamedDeclaration(declaration, [], null));
						} else if (this.matchAsyncFunction()) {
							var declaration = this.parseFunctionDeclaration();
							exportDeclaration = this.finalize(node, new Node.ExportNamedDeclaration(declaration, [], null));
						} else {
							var specifiers = [];
							var source = null;
							var isExportFromIdentifier = false;
							this.expect("{");
							while (!this.match("}")) {
								isExportFromIdentifier = isExportFromIdentifier || this.matchKeyword("default");
								specifiers.push(this.parseExportSpecifier());
								if (!this.match("}")) this.expect(",");
							}
							this.expect("}");
							if (this.matchContextualKeyword("from")) {
								this.nextToken();
								source = this.parseModuleSpecifier();
								this.consumeSemicolon();
							} else if (isExportFromIdentifier) {
								var message = this.lookahead.value ? messages_1.Messages.UnexpectedToken : messages_1.Messages.MissingFromClause;
								this.throwError(message, this.lookahead.value);
							} else this.consumeSemicolon();
							exportDeclaration = this.finalize(node, new Node.ExportNamedDeclaration(null, specifiers, source));
						}
						return exportDeclaration;
					};
					return Parser;
				}();
			},
			function(module, exports) {
				"use strict";
				Object.defineProperty(exports, "__esModule", { value: true });
				function assert(condition, message) {
					/* istanbul ignore if */
					if (!condition) throw new Error("ASSERT: " + message);
				}
				exports.assert = assert;
			},
			function(module, exports) {
				"use strict";
				Object.defineProperty(exports, "__esModule", { value: true });
				exports.ErrorHandler = function() {
					function ErrorHandler() {
						this.errors = [];
						this.tolerant = false;
					}
					ErrorHandler.prototype.recordError = function(error) {
						this.errors.push(error);
					};
					ErrorHandler.prototype.tolerate = function(error) {
						if (this.tolerant) this.recordError(error);
						else throw error;
					};
					ErrorHandler.prototype.constructError = function(msg, column) {
						var error = new Error(msg);
						try {
							throw error;
						} catch (base) {
							/* istanbul ignore else */
							if (Object.create && Object.defineProperty) {
								error = Object.create(base);
								Object.defineProperty(error, "column", { value: column });
							}
						}
						/* istanbul ignore next */
						return error;
					};
					ErrorHandler.prototype.createError = function(index, line, col, description) {
						var msg = "Line " + line + ": " + description;
						var error = this.constructError(msg, col);
						error.index = index;
						error.lineNumber = line;
						error.description = description;
						return error;
					};
					ErrorHandler.prototype.throwError = function(index, line, col, description) {
						throw this.createError(index, line, col, description);
					};
					ErrorHandler.prototype.tolerateError = function(index, line, col, description) {
						var error = this.createError(index, line, col, description);
						if (this.tolerant) this.recordError(error);
						else throw error;
					};
					return ErrorHandler;
				}();
			},
			function(module, exports) {
				"use strict";
				Object.defineProperty(exports, "__esModule", { value: true });
				exports.Messages = {
					BadGetterArity: "Getter must not have any formal parameters",
					BadSetterArity: "Setter must have exactly one formal parameter",
					BadSetterRestParameter: "Setter function argument must not be a rest parameter",
					ConstructorIsAsync: "Class constructor may not be an async method",
					ConstructorSpecialMethod: "Class constructor may not be an accessor",
					DeclarationMissingInitializer: "Missing initializer in %0 declaration",
					DefaultRestParameter: "Unexpected token =",
					DuplicateBinding: "Duplicate binding %0",
					DuplicateConstructor: "A class may only have one constructor",
					DuplicateProtoProperty: "Duplicate __proto__ fields are not allowed in object literals",
					ForInOfLoopInitializer: "%0 loop variable declaration may not have an initializer",
					GeneratorInLegacyContext: "Generator declarations are not allowed in legacy contexts",
					IllegalBreak: "Illegal break statement",
					IllegalContinue: "Illegal continue statement",
					IllegalExportDeclaration: "Unexpected token",
					IllegalImportDeclaration: "Unexpected token",
					IllegalLanguageModeDirective: "Illegal 'use strict' directive in function with non-simple parameter list",
					IllegalReturn: "Illegal return statement",
					InvalidEscapedReservedWord: "Keyword must not contain escaped characters",
					InvalidHexEscapeSequence: "Invalid hexadecimal escape sequence",
					InvalidLHSInAssignment: "Invalid left-hand side in assignment",
					InvalidLHSInForIn: "Invalid left-hand side in for-in",
					InvalidLHSInForLoop: "Invalid left-hand side in for-loop",
					InvalidModuleSpecifier: "Unexpected token",
					InvalidRegExp: "Invalid regular expression",
					LetInLexicalBinding: "let is disallowed as a lexically bound name",
					MissingFromClause: "Unexpected token",
					MultipleDefaultsInSwitch: "More than one default clause in switch statement",
					NewlineAfterThrow: "Illegal newline after throw",
					NoAsAfterImportNamespace: "Unexpected token",
					NoCatchOrFinally: "Missing catch or finally after try",
					ParameterAfterRestParameter: "Rest parameter must be last formal parameter",
					Redeclaration: "%0 '%1' has already been declared",
					StaticPrototype: "Classes may not have static property named prototype",
					StrictCatchVariable: "Catch variable may not be eval or arguments in strict mode",
					StrictDelete: "Delete of an unqualified identifier in strict mode.",
					StrictFunction: "In strict mode code, functions can only be declared at top level or inside a block",
					StrictFunctionName: "Function name may not be eval or arguments in strict mode",
					StrictLHSAssignment: "Assignment to eval or arguments is not allowed in strict mode",
					StrictLHSPostfix: "Postfix increment/decrement may not have eval or arguments operand in strict mode",
					StrictLHSPrefix: "Prefix increment/decrement may not have eval or arguments operand in strict mode",
					StrictModeWith: "Strict mode code may not include a with statement",
					StrictOctalLiteral: "Octal literals are not allowed in strict mode.",
					StrictParamDupe: "Strict mode function may not have duplicate parameter names",
					StrictParamName: "Parameter name eval or arguments is not allowed in strict mode",
					StrictReservedWord: "Use of future reserved word in strict mode",
					StrictVarName: "Variable name may not be eval or arguments in strict mode",
					TemplateOctalLiteral: "Octal literals are not allowed in template strings.",
					UnexpectedEOS: "Unexpected end of input",
					UnexpectedIdentifier: "Unexpected identifier",
					UnexpectedNumber: "Unexpected number",
					UnexpectedReserved: "Unexpected reserved word",
					UnexpectedString: "Unexpected string",
					UnexpectedTemplate: "Unexpected quasi %0",
					UnexpectedToken: "Unexpected token %0",
					UnexpectedTokenIllegal: "Unexpected token ILLEGAL",
					UnknownLabel: "Undefined label '%0'",
					UnterminatedRegExp: "Invalid regular expression: missing /"
				};
			},
			function(module, exports, __webpack_require__) {
				"use strict";
				Object.defineProperty(exports, "__esModule", { value: true });
				var assert_1 = __webpack_require__(9);
				var character_1 = __webpack_require__(4);
				var messages_1 = __webpack_require__(11);
				function hexValue(ch) {
					return "0123456789abcdef".indexOf(ch.toLowerCase());
				}
				function octalValue(ch) {
					return "01234567".indexOf(ch);
				}
				exports.Scanner = function() {
					function Scanner(code, handler) {
						this.source = code;
						this.errorHandler = handler;
						this.trackComment = false;
						this.isModule = false;
						this.length = code.length;
						this.index = 0;
						this.lineNumber = code.length > 0 ? 1 : 0;
						this.lineStart = 0;
						this.curlyStack = [];
					}
					Scanner.prototype.saveState = function() {
						return {
							index: this.index,
							lineNumber: this.lineNumber,
							lineStart: this.lineStart
						};
					};
					Scanner.prototype.restoreState = function(state) {
						this.index = state.index;
						this.lineNumber = state.lineNumber;
						this.lineStart = state.lineStart;
					};
					Scanner.prototype.eof = function() {
						return this.index >= this.length;
					};
					Scanner.prototype.throwUnexpectedToken = function(message) {
						if (message === void 0) message = messages_1.Messages.UnexpectedTokenIllegal;
						return this.errorHandler.throwError(this.index, this.lineNumber, this.index - this.lineStart + 1, message);
					};
					Scanner.prototype.tolerateUnexpectedToken = function(message) {
						if (message === void 0) message = messages_1.Messages.UnexpectedTokenIllegal;
						this.errorHandler.tolerateError(this.index, this.lineNumber, this.index - this.lineStart + 1, message);
					};
					Scanner.prototype.skipSingleLineComment = function(offset) {
						var comments = [];
						var start, loc;
						if (this.trackComment) {
							comments = [];
							start = this.index - offset;
							loc = {
								start: {
									line: this.lineNumber,
									column: this.index - this.lineStart - offset
								},
								end: {}
							};
						}
						while (!this.eof()) {
							var ch = this.source.charCodeAt(this.index);
							++this.index;
							if (character_1.Character.isLineTerminator(ch)) {
								if (this.trackComment) {
									loc.end = {
										line: this.lineNumber,
										column: this.index - this.lineStart - 1
									};
									var entry = {
										multiLine: false,
										slice: [start + offset, this.index - 1],
										range: [start, this.index - 1],
										loc
									};
									comments.push(entry);
								}
								if (ch === 13 && this.source.charCodeAt(this.index) === 10) ++this.index;
								++this.lineNumber;
								this.lineStart = this.index;
								return comments;
							}
						}
						if (this.trackComment) {
							loc.end = {
								line: this.lineNumber,
								column: this.index - this.lineStart
							};
							var entry = {
								multiLine: false,
								slice: [start + offset, this.index],
								range: [start, this.index],
								loc
							};
							comments.push(entry);
						}
						return comments;
					};
					Scanner.prototype.skipMultiLineComment = function() {
						var comments = [];
						var start, loc;
						if (this.trackComment) {
							comments = [];
							start = this.index - 2;
							loc = {
								start: {
									line: this.lineNumber,
									column: this.index - this.lineStart - 2
								},
								end: {}
							};
						}
						while (!this.eof()) {
							var ch = this.source.charCodeAt(this.index);
							if (character_1.Character.isLineTerminator(ch)) {
								if (ch === 13 && this.source.charCodeAt(this.index + 1) === 10) ++this.index;
								++this.lineNumber;
								++this.index;
								this.lineStart = this.index;
							} else if (ch === 42) {
								if (this.source.charCodeAt(this.index + 1) === 47) {
									this.index += 2;
									if (this.trackComment) {
										loc.end = {
											line: this.lineNumber,
											column: this.index - this.lineStart
										};
										var entry = {
											multiLine: true,
											slice: [start + 2, this.index - 2],
											range: [start, this.index],
											loc
										};
										comments.push(entry);
									}
									return comments;
								}
								++this.index;
							} else ++this.index;
						}
						if (this.trackComment) {
							loc.end = {
								line: this.lineNumber,
								column: this.index - this.lineStart
							};
							var entry = {
								multiLine: true,
								slice: [start + 2, this.index],
								range: [start, this.index],
								loc
							};
							comments.push(entry);
						}
						this.tolerateUnexpectedToken();
						return comments;
					};
					Scanner.prototype.scanComments = function() {
						var comments;
						if (this.trackComment) comments = [];
						var start = this.index === 0;
						while (!this.eof()) {
							var ch = this.source.charCodeAt(this.index);
							if (character_1.Character.isWhiteSpace(ch)) ++this.index;
							else if (character_1.Character.isLineTerminator(ch)) {
								++this.index;
								if (ch === 13 && this.source.charCodeAt(this.index) === 10) ++this.index;
								++this.lineNumber;
								this.lineStart = this.index;
								start = true;
							} else if (ch === 47) {
								ch = this.source.charCodeAt(this.index + 1);
								if (ch === 47) {
									this.index += 2;
									var comment = this.skipSingleLineComment(2);
									if (this.trackComment) comments = comments.concat(comment);
									start = true;
								} else if (ch === 42) {
									this.index += 2;
									var comment = this.skipMultiLineComment();
									if (this.trackComment) comments = comments.concat(comment);
								} else break;
							} else if (start && ch === 45) {
								if (this.source.charCodeAt(this.index + 1) === 45 && this.source.charCodeAt(this.index + 2) === 62) {
									this.index += 3;
									var comment = this.skipSingleLineComment(3);
									if (this.trackComment) comments = comments.concat(comment);
								} else break;
							} else if (ch === 60 && !this.isModule) {
								if (this.source.slice(this.index + 1, this.index + 4) === "!--") {
									this.index += 4;
									var comment = this.skipSingleLineComment(4);
									if (this.trackComment) comments = comments.concat(comment);
								} else break;
							} else break;
						}
						return comments;
					};
					Scanner.prototype.isFutureReservedWord = function(id) {
						switch (id) {
							case "enum":
							case "export":
							case "import":
							case "super": return true;
							default: return false;
						}
					};
					Scanner.prototype.isStrictModeReservedWord = function(id) {
						switch (id) {
							case "implements":
							case "interface":
							case "package":
							case "private":
							case "protected":
							case "public":
							case "static":
							case "yield":
							case "let": return true;
							default: return false;
						}
					};
					Scanner.prototype.isRestrictedWord = function(id) {
						return id === "eval" || id === "arguments";
					};
					Scanner.prototype.isKeyword = function(id) {
						switch (id.length) {
							case 2: return id === "if" || id === "in" || id === "do";
							case 3: return id === "var" || id === "for" || id === "new" || id === "try" || id === "let";
							case 4: return id === "this" || id === "else" || id === "case" || id === "void" || id === "with" || id === "enum";
							case 5: return id === "while" || id === "break" || id === "catch" || id === "throw" || id === "const" || id === "yield" || id === "class" || id === "super";
							case 6: return id === "return" || id === "typeof" || id === "delete" || id === "switch" || id === "export" || id === "import";
							case 7: return id === "default" || id === "finally" || id === "extends";
							case 8: return id === "function" || id === "continue" || id === "debugger";
							case 10: return id === "instanceof";
							default: return false;
						}
					};
					Scanner.prototype.codePointAt = function(i) {
						var cp = this.source.charCodeAt(i);
						if (cp >= 55296 && cp <= 56319) {
							var second = this.source.charCodeAt(i + 1);
							if (second >= 56320 && second <= 57343) cp = (cp - 55296) * 1024 + second - 56320 + 65536;
						}
						return cp;
					};
					Scanner.prototype.scanHexEscape = function(prefix) {
						var len = prefix === "u" ? 4 : 2;
						var code = 0;
						for (var i = 0; i < len; ++i) if (!this.eof() && character_1.Character.isHexDigit(this.source.charCodeAt(this.index))) code = code * 16 + hexValue(this.source[this.index++]);
						else return null;
						return String.fromCharCode(code);
					};
					Scanner.prototype.scanUnicodeCodePointEscape = function() {
						var ch = this.source[this.index];
						var code = 0;
						if (ch === "}") this.throwUnexpectedToken();
						while (!this.eof()) {
							ch = this.source[this.index++];
							if (!character_1.Character.isHexDigit(ch.charCodeAt(0))) break;
							code = code * 16 + hexValue(ch);
						}
						if (code > 1114111 || ch !== "}") this.throwUnexpectedToken();
						return character_1.Character.fromCodePoint(code);
					};
					Scanner.prototype.getIdentifier = function() {
						var start = this.index++;
						while (!this.eof()) {
							var ch = this.source.charCodeAt(this.index);
							if (ch === 92) {
								this.index = start;
								return this.getComplexIdentifier();
							} else if (ch >= 55296 && ch < 57343) {
								this.index = start;
								return this.getComplexIdentifier();
							}
							if (character_1.Character.isIdentifierPart(ch)) ++this.index;
							else break;
						}
						return this.source.slice(start, this.index);
					};
					Scanner.prototype.getComplexIdentifier = function() {
						var cp = this.codePointAt(this.index);
						var id = character_1.Character.fromCodePoint(cp);
						this.index += id.length;
						var ch;
						if (cp === 92) {
							if (this.source.charCodeAt(this.index) !== 117) this.throwUnexpectedToken();
							++this.index;
							if (this.source[this.index] === "{") {
								++this.index;
								ch = this.scanUnicodeCodePointEscape();
							} else {
								ch = this.scanHexEscape("u");
								if (ch === null || ch === "\\" || !character_1.Character.isIdentifierStart(ch.charCodeAt(0))) this.throwUnexpectedToken();
							}
							id = ch;
						}
						while (!this.eof()) {
							cp = this.codePointAt(this.index);
							if (!character_1.Character.isIdentifierPart(cp)) break;
							ch = character_1.Character.fromCodePoint(cp);
							id += ch;
							this.index += ch.length;
							if (cp === 92) {
								id = id.substr(0, id.length - 1);
								if (this.source.charCodeAt(this.index) !== 117) this.throwUnexpectedToken();
								++this.index;
								if (this.source[this.index] === "{") {
									++this.index;
									ch = this.scanUnicodeCodePointEscape();
								} else {
									ch = this.scanHexEscape("u");
									if (ch === null || ch === "\\" || !character_1.Character.isIdentifierPart(ch.charCodeAt(0))) this.throwUnexpectedToken();
								}
								id += ch;
							}
						}
						return id;
					};
					Scanner.prototype.octalToDecimal = function(ch) {
						var octal = ch !== "0";
						var code = octalValue(ch);
						if (!this.eof() && character_1.Character.isOctalDigit(this.source.charCodeAt(this.index))) {
							octal = true;
							code = code * 8 + octalValue(this.source[this.index++]);
							if ("0123".indexOf(ch) >= 0 && !this.eof() && character_1.Character.isOctalDigit(this.source.charCodeAt(this.index))) code = code * 8 + octalValue(this.source[this.index++]);
						}
						return {
							code,
							octal
						};
					};
					Scanner.prototype.scanIdentifier = function() {
						var type;
						var start = this.index;
						var id = this.source.charCodeAt(start) === 92 ? this.getComplexIdentifier() : this.getIdentifier();
						if (id.length === 1) type = 3;
						else if (this.isKeyword(id)) type = 4;
						else if (id === "null") type = 5;
						else if (id === "true" || id === "false") type = 1;
						else type = 3;
						if (type !== 3 && start + id.length !== this.index) {
							var restore = this.index;
							this.index = start;
							this.tolerateUnexpectedToken(messages_1.Messages.InvalidEscapedReservedWord);
							this.index = restore;
						}
						return {
							type,
							value: id,
							lineNumber: this.lineNumber,
							lineStart: this.lineStart,
							start,
							end: this.index
						};
					};
					Scanner.prototype.scanPunctuator = function() {
						var start = this.index;
						var str = this.source[this.index];
						switch (str) {
							case "(":
							case "{":
								if (str === "{") this.curlyStack.push("{");
								++this.index;
								break;
							case ".":
								++this.index;
								if (this.source[this.index] === "." && this.source[this.index + 1] === ".") {
									this.index += 2;
									str = "...";
								}
								break;
							case "}":
								++this.index;
								this.curlyStack.pop();
								break;
							case ")":
							case ";":
							case ",":
							case "[":
							case "]":
							case ":":
							case "?":
							case "~":
								++this.index;
								break;
							default:
								str = this.source.substr(this.index, 4);
								if (str === ">>>=") this.index += 4;
								else {
									str = str.substr(0, 3);
									if (str === "===" || str === "!==" || str === ">>>" || str === "<<=" || str === ">>=" || str === "**=") this.index += 3;
									else {
										str = str.substr(0, 2);
										if (str === "&&" || str === "||" || str === "==" || str === "!=" || str === "+=" || str === "-=" || str === "*=" || str === "/=" || str === "++" || str === "--" || str === "<<" || str === ">>" || str === "&=" || str === "|=" || str === "^=" || str === "%=" || str === "<=" || str === ">=" || str === "=>" || str === "**") this.index += 2;
										else {
											str = this.source[this.index];
											if ("<>=!+-*%&|^/".indexOf(str) >= 0) ++this.index;
										}
									}
								}
						}
						if (this.index === start) this.throwUnexpectedToken();
						return {
							type: 7,
							value: str,
							lineNumber: this.lineNumber,
							lineStart: this.lineStart,
							start,
							end: this.index
						};
					};
					Scanner.prototype.scanHexLiteral = function(start) {
						var num = "";
						while (!this.eof()) {
							if (!character_1.Character.isHexDigit(this.source.charCodeAt(this.index))) break;
							num += this.source[this.index++];
						}
						if (num.length === 0) this.throwUnexpectedToken();
						if (character_1.Character.isIdentifierStart(this.source.charCodeAt(this.index))) this.throwUnexpectedToken();
						return {
							type: 6,
							value: parseInt("0x" + num, 16),
							lineNumber: this.lineNumber,
							lineStart: this.lineStart,
							start,
							end: this.index
						};
					};
					Scanner.prototype.scanBinaryLiteral = function(start) {
						var num = "";
						var ch;
						while (!this.eof()) {
							ch = this.source[this.index];
							if (ch !== "0" && ch !== "1") break;
							num += this.source[this.index++];
						}
						if (num.length === 0) this.throwUnexpectedToken();
						if (!this.eof()) {
							ch = this.source.charCodeAt(this.index);
							/* istanbul ignore else */
							if (character_1.Character.isIdentifierStart(ch) || character_1.Character.isDecimalDigit(ch)) this.throwUnexpectedToken();
						}
						return {
							type: 6,
							value: parseInt(num, 2),
							lineNumber: this.lineNumber,
							lineStart: this.lineStart,
							start,
							end: this.index
						};
					};
					Scanner.prototype.scanOctalLiteral = function(prefix, start) {
						var num = "";
						var octal = false;
						if (character_1.Character.isOctalDigit(prefix.charCodeAt(0))) {
							octal = true;
							num = "0" + this.source[this.index++];
						} else ++this.index;
						while (!this.eof()) {
							if (!character_1.Character.isOctalDigit(this.source.charCodeAt(this.index))) break;
							num += this.source[this.index++];
						}
						if (!octal && num.length === 0) this.throwUnexpectedToken();
						if (character_1.Character.isIdentifierStart(this.source.charCodeAt(this.index)) || character_1.Character.isDecimalDigit(this.source.charCodeAt(this.index))) this.throwUnexpectedToken();
						return {
							type: 6,
							value: parseInt(num, 8),
							octal,
							lineNumber: this.lineNumber,
							lineStart: this.lineStart,
							start,
							end: this.index
						};
					};
					Scanner.prototype.isImplicitOctalLiteral = function() {
						for (var i = this.index + 1; i < this.length; ++i) {
							var ch = this.source[i];
							if (ch === "8" || ch === "9") return false;
							if (!character_1.Character.isOctalDigit(ch.charCodeAt(0))) return true;
						}
						return true;
					};
					Scanner.prototype.scanNumericLiteral = function() {
						var start = this.index;
						var ch = this.source[start];
						assert_1.assert(character_1.Character.isDecimalDigit(ch.charCodeAt(0)) || ch === ".", "Numeric literal must start with a decimal digit or a decimal point");
						var num = "";
						if (ch !== ".") {
							num = this.source[this.index++];
							ch = this.source[this.index];
							if (num === "0") {
								if (ch === "x" || ch === "X") {
									++this.index;
									return this.scanHexLiteral(start);
								}
								if (ch === "b" || ch === "B") {
									++this.index;
									return this.scanBinaryLiteral(start);
								}
								if (ch === "o" || ch === "O") return this.scanOctalLiteral(ch, start);
								if (ch && character_1.Character.isOctalDigit(ch.charCodeAt(0))) {
									if (this.isImplicitOctalLiteral()) return this.scanOctalLiteral(ch, start);
								}
							}
							while (character_1.Character.isDecimalDigit(this.source.charCodeAt(this.index))) num += this.source[this.index++];
							ch = this.source[this.index];
						}
						if (ch === ".") {
							num += this.source[this.index++];
							while (character_1.Character.isDecimalDigit(this.source.charCodeAt(this.index))) num += this.source[this.index++];
							ch = this.source[this.index];
						}
						if (ch === "e" || ch === "E") {
							num += this.source[this.index++];
							ch = this.source[this.index];
							if (ch === "+" || ch === "-") num += this.source[this.index++];
							if (character_1.Character.isDecimalDigit(this.source.charCodeAt(this.index))) while (character_1.Character.isDecimalDigit(this.source.charCodeAt(this.index))) num += this.source[this.index++];
							else this.throwUnexpectedToken();
						}
						if (character_1.Character.isIdentifierStart(this.source.charCodeAt(this.index))) this.throwUnexpectedToken();
						return {
							type: 6,
							value: parseFloat(num),
							lineNumber: this.lineNumber,
							lineStart: this.lineStart,
							start,
							end: this.index
						};
					};
					Scanner.prototype.scanStringLiteral = function() {
						var start = this.index;
						var quote = this.source[start];
						assert_1.assert(quote === "'" || quote === "\"", "String literal must starts with a quote");
						++this.index;
						var octal = false;
						var str = "";
						while (!this.eof()) {
							var ch = this.source[this.index++];
							if (ch === quote) {
								quote = "";
								break;
							} else if (ch === "\\") {
								ch = this.source[this.index++];
								if (!ch || !character_1.Character.isLineTerminator(ch.charCodeAt(0))) switch (ch) {
									case "u":
										if (this.source[this.index] === "{") {
											++this.index;
											str += this.scanUnicodeCodePointEscape();
										} else {
											var unescaped_1 = this.scanHexEscape(ch);
											if (unescaped_1 === null) this.throwUnexpectedToken();
											str += unescaped_1;
										}
										break;
									case "x":
										var unescaped = this.scanHexEscape(ch);
										if (unescaped === null) this.throwUnexpectedToken(messages_1.Messages.InvalidHexEscapeSequence);
										str += unescaped;
										break;
									case "n":
										str += "\n";
										break;
									case "r":
										str += "\r";
										break;
									case "t":
										str += "	";
										break;
									case "b":
										str += "\b";
										break;
									case "f":
										str += "\f";
										break;
									case "v":
										str += "\v";
										break;
									case "8":
									case "9":
										str += ch;
										this.tolerateUnexpectedToken();
										break;
									default: if (ch && character_1.Character.isOctalDigit(ch.charCodeAt(0))) {
										var octToDec = this.octalToDecimal(ch);
										octal = octToDec.octal || octal;
										str += String.fromCharCode(octToDec.code);
									} else str += ch;
								}
								else {
									++this.lineNumber;
									if (ch === "\r" && this.source[this.index] === "\n") ++this.index;
									this.lineStart = this.index;
								}
							} else if (character_1.Character.isLineTerminator(ch.charCodeAt(0))) break;
							else str += ch;
						}
						if (quote !== "") {
							this.index = start;
							this.throwUnexpectedToken();
						}
						return {
							type: 8,
							value: str,
							octal,
							lineNumber: this.lineNumber,
							lineStart: this.lineStart,
							start,
							end: this.index
						};
					};
					Scanner.prototype.scanTemplate = function() {
						var cooked = "";
						var terminated = false;
						var start = this.index;
						var head = this.source[start] === "`";
						var tail = false;
						var rawOffset = 2;
						++this.index;
						while (!this.eof()) {
							var ch = this.source[this.index++];
							if (ch === "`") {
								rawOffset = 1;
								tail = true;
								terminated = true;
								break;
							} else if (ch === "$") {
								if (this.source[this.index] === "{") {
									this.curlyStack.push("${");
									++this.index;
									terminated = true;
									break;
								}
								cooked += ch;
							} else if (ch === "\\") {
								ch = this.source[this.index++];
								if (!character_1.Character.isLineTerminator(ch.charCodeAt(0))) switch (ch) {
									case "n":
										cooked += "\n";
										break;
									case "r":
										cooked += "\r";
										break;
									case "t":
										cooked += "	";
										break;
									case "u":
										if (this.source[this.index] === "{") {
											++this.index;
											cooked += this.scanUnicodeCodePointEscape();
										} else {
											var restore = this.index;
											var unescaped_2 = this.scanHexEscape(ch);
											if (unescaped_2 !== null) cooked += unescaped_2;
											else {
												this.index = restore;
												cooked += ch;
											}
										}
										break;
									case "x":
										var unescaped = this.scanHexEscape(ch);
										if (unescaped === null) this.throwUnexpectedToken(messages_1.Messages.InvalidHexEscapeSequence);
										cooked += unescaped;
										break;
									case "b":
										cooked += "\b";
										break;
									case "f":
										cooked += "\f";
										break;
									case "v":
										cooked += "\v";
										break;
									default: if (ch === "0") {
										if (character_1.Character.isDecimalDigit(this.source.charCodeAt(this.index))) this.throwUnexpectedToken(messages_1.Messages.TemplateOctalLiteral);
										cooked += "\0";
									} else if (character_1.Character.isOctalDigit(ch.charCodeAt(0))) this.throwUnexpectedToken(messages_1.Messages.TemplateOctalLiteral);
									else cooked += ch;
								}
								else {
									++this.lineNumber;
									if (ch === "\r" && this.source[this.index] === "\n") ++this.index;
									this.lineStart = this.index;
								}
							} else if (character_1.Character.isLineTerminator(ch.charCodeAt(0))) {
								++this.lineNumber;
								if (ch === "\r" && this.source[this.index] === "\n") ++this.index;
								this.lineStart = this.index;
								cooked += "\n";
							} else cooked += ch;
						}
						if (!terminated) this.throwUnexpectedToken();
						if (!head) this.curlyStack.pop();
						return {
							type: 10,
							value: this.source.slice(start + 1, this.index - rawOffset),
							cooked,
							head,
							tail,
							lineNumber: this.lineNumber,
							lineStart: this.lineStart,
							start,
							end: this.index
						};
					};
					Scanner.prototype.testRegExp = function(pattern, flags) {
						var astralSubstitute = "￿";
						var tmp = pattern;
						var self = this;
						if (flags.indexOf("u") >= 0) tmp = tmp.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([a-fA-F0-9]{4})/g, function($0, $1, $2) {
							var codePoint = parseInt($1 || $2, 16);
							if (codePoint > 1114111) self.throwUnexpectedToken(messages_1.Messages.InvalidRegExp);
							if (codePoint <= 65535) return String.fromCharCode(codePoint);
							return astralSubstitute;
						}).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, astralSubstitute);
						try {
							RegExp(tmp);
						} catch (e) {
							this.throwUnexpectedToken(messages_1.Messages.InvalidRegExp);
						}
						try {
							return new RegExp(pattern, flags);
						} catch (exception) {
							/* istanbul ignore next */
							return null;
						}
					};
					Scanner.prototype.scanRegExpBody = function() {
						var ch = this.source[this.index];
						assert_1.assert(ch === "/", "Regular expression literal must start with a slash");
						var str = this.source[this.index++];
						var classMarker = false;
						var terminated = false;
						while (!this.eof()) {
							ch = this.source[this.index++];
							str += ch;
							if (ch === "\\") {
								ch = this.source[this.index++];
								if (character_1.Character.isLineTerminator(ch.charCodeAt(0))) this.throwUnexpectedToken(messages_1.Messages.UnterminatedRegExp);
								str += ch;
							} else if (character_1.Character.isLineTerminator(ch.charCodeAt(0))) this.throwUnexpectedToken(messages_1.Messages.UnterminatedRegExp);
							else if (classMarker) {
								if (ch === "]") classMarker = false;
							} else if (ch === "/") {
								terminated = true;
								break;
							} else if (ch === "[") classMarker = true;
						}
						if (!terminated) this.throwUnexpectedToken(messages_1.Messages.UnterminatedRegExp);
						return str.substr(1, str.length - 2);
					};
					Scanner.prototype.scanRegExpFlags = function() {
						var str = "";
						var flags = "";
						while (!this.eof()) {
							var ch = this.source[this.index];
							if (!character_1.Character.isIdentifierPart(ch.charCodeAt(0))) break;
							++this.index;
							if (ch === "\\" && !this.eof()) {
								ch = this.source[this.index];
								if (ch === "u") {
									++this.index;
									var restore = this.index;
									var char = this.scanHexEscape("u");
									if (char !== null) {
										flags += char;
										for (str += "\\u"; restore < this.index; ++restore) str += this.source[restore];
									} else {
										this.index = restore;
										flags += "u";
										str += "\\u";
									}
									this.tolerateUnexpectedToken();
								} else {
									str += "\\";
									this.tolerateUnexpectedToken();
								}
							} else {
								flags += ch;
								str += ch;
							}
						}
						return flags;
					};
					Scanner.prototype.scanRegExp = function() {
						var start = this.index;
						var pattern = this.scanRegExpBody();
						var flags = this.scanRegExpFlags();
						return {
							type: 9,
							value: "",
							pattern,
							flags,
							regex: this.testRegExp(pattern, flags),
							lineNumber: this.lineNumber,
							lineStart: this.lineStart,
							start,
							end: this.index
						};
					};
					Scanner.prototype.lex = function() {
						if (this.eof()) return {
							type: 2,
							value: "",
							lineNumber: this.lineNumber,
							lineStart: this.lineStart,
							start: this.index,
							end: this.index
						};
						var cp = this.source.charCodeAt(this.index);
						if (character_1.Character.isIdentifierStart(cp)) return this.scanIdentifier();
						if (cp === 40 || cp === 41 || cp === 59) return this.scanPunctuator();
						if (cp === 39 || cp === 34) return this.scanStringLiteral();
						if (cp === 46) {
							if (character_1.Character.isDecimalDigit(this.source.charCodeAt(this.index + 1))) return this.scanNumericLiteral();
							return this.scanPunctuator();
						}
						if (character_1.Character.isDecimalDigit(cp)) return this.scanNumericLiteral();
						if (cp === 96 || cp === 125 && this.curlyStack[this.curlyStack.length - 1] === "${") return this.scanTemplate();
						if (cp >= 55296 && cp < 57343) {
							if (character_1.Character.isIdentifierStart(this.codePointAt(this.index))) return this.scanIdentifier();
						}
						return this.scanPunctuator();
					};
					return Scanner;
				}();
			},
			function(module, exports) {
				"use strict";
				Object.defineProperty(exports, "__esModule", { value: true });
				exports.TokenName = {};
				exports.TokenName[1] = "Boolean";
				exports.TokenName[2] = "<end>";
				exports.TokenName[3] = "Identifier";
				exports.TokenName[4] = "Keyword";
				exports.TokenName[5] = "Null";
				exports.TokenName[6] = "Numeric";
				exports.TokenName[7] = "Punctuator";
				exports.TokenName[8] = "String";
				exports.TokenName[9] = "RegularExpression";
				exports.TokenName[10] = "Template";
			},
			function(module, exports) {
				"use strict";
				Object.defineProperty(exports, "__esModule", { value: true });
				exports.XHTMLEntities = {
					quot: "\"",
					amp: "&",
					apos: "'",
					gt: ">",
					nbsp: "\xA0",
					iexcl: "¡",
					cent: "¢",
					pound: "£",
					curren: "¤",
					yen: "¥",
					brvbar: "¦",
					sect: "§",
					uml: "¨",
					copy: "©",
					ordf: "ª",
					laquo: "«",
					not: "¬",
					shy: "­",
					reg: "®",
					macr: "¯",
					deg: "°",
					plusmn: "±",
					sup2: "²",
					sup3: "³",
					acute: "´",
					micro: "µ",
					para: "¶",
					middot: "·",
					cedil: "¸",
					sup1: "¹",
					ordm: "º",
					raquo: "»",
					frac14: "¼",
					frac12: "½",
					frac34: "¾",
					iquest: "¿",
					Agrave: "À",
					Aacute: "Á",
					Acirc: "Â",
					Atilde: "Ã",
					Auml: "Ä",
					Aring: "Å",
					AElig: "Æ",
					Ccedil: "Ç",
					Egrave: "È",
					Eacute: "É",
					Ecirc: "Ê",
					Euml: "Ë",
					Igrave: "Ì",
					Iacute: "Í",
					Icirc: "Î",
					Iuml: "Ï",
					ETH: "Ð",
					Ntilde: "Ñ",
					Ograve: "Ò",
					Oacute: "Ó",
					Ocirc: "Ô",
					Otilde: "Õ",
					Ouml: "Ö",
					times: "×",
					Oslash: "Ø",
					Ugrave: "Ù",
					Uacute: "Ú",
					Ucirc: "Û",
					Uuml: "Ü",
					Yacute: "Ý",
					THORN: "Þ",
					szlig: "ß",
					agrave: "à",
					aacute: "á",
					acirc: "â",
					atilde: "ã",
					auml: "ä",
					aring: "å",
					aelig: "æ",
					ccedil: "ç",
					egrave: "è",
					eacute: "é",
					ecirc: "ê",
					euml: "ë",
					igrave: "ì",
					iacute: "í",
					icirc: "î",
					iuml: "ï",
					eth: "ð",
					ntilde: "ñ",
					ograve: "ò",
					oacute: "ó",
					ocirc: "ô",
					otilde: "õ",
					ouml: "ö",
					divide: "÷",
					oslash: "ø",
					ugrave: "ù",
					uacute: "ú",
					ucirc: "û",
					uuml: "ü",
					yacute: "ý",
					thorn: "þ",
					yuml: "ÿ",
					OElig: "Œ",
					oelig: "œ",
					Scaron: "Š",
					scaron: "š",
					Yuml: "Ÿ",
					fnof: "ƒ",
					circ: "ˆ",
					tilde: "˜",
					Alpha: "Α",
					Beta: "Β",
					Gamma: "Γ",
					Delta: "Δ",
					Epsilon: "Ε",
					Zeta: "Ζ",
					Eta: "Η",
					Theta: "Θ",
					Iota: "Ι",
					Kappa: "Κ",
					Lambda: "Λ",
					Mu: "Μ",
					Nu: "Ν",
					Xi: "Ξ",
					Omicron: "Ο",
					Pi: "Π",
					Rho: "Ρ",
					Sigma: "Σ",
					Tau: "Τ",
					Upsilon: "Υ",
					Phi: "Φ",
					Chi: "Χ",
					Psi: "Ψ",
					Omega: "Ω",
					alpha: "α",
					beta: "β",
					gamma: "γ",
					delta: "δ",
					epsilon: "ε",
					zeta: "ζ",
					eta: "η",
					theta: "θ",
					iota: "ι",
					kappa: "κ",
					lambda: "λ",
					mu: "μ",
					nu: "ν",
					xi: "ξ",
					omicron: "ο",
					pi: "π",
					rho: "ρ",
					sigmaf: "ς",
					sigma: "σ",
					tau: "τ",
					upsilon: "υ",
					phi: "φ",
					chi: "χ",
					psi: "ψ",
					omega: "ω",
					thetasym: "ϑ",
					upsih: "ϒ",
					piv: "ϖ",
					ensp: " ",
					emsp: " ",
					thinsp: " ",
					zwnj: "‌",
					zwj: "‍",
					lrm: "‎",
					rlm: "‏",
					ndash: "–",
					mdash: "—",
					lsquo: "‘",
					rsquo: "’",
					sbquo: "‚",
					ldquo: "“",
					rdquo: "”",
					bdquo: "„",
					dagger: "†",
					Dagger: "‡",
					bull: "•",
					hellip: "…",
					permil: "‰",
					prime: "′",
					Prime: "″",
					lsaquo: "‹",
					rsaquo: "›",
					oline: "‾",
					frasl: "⁄",
					euro: "€",
					image: "ℑ",
					weierp: "℘",
					real: "ℜ",
					trade: "™",
					alefsym: "ℵ",
					larr: "←",
					uarr: "↑",
					rarr: "→",
					darr: "↓",
					harr: "↔",
					crarr: "↵",
					lArr: "⇐",
					uArr: "⇑",
					rArr: "⇒",
					dArr: "⇓",
					hArr: "⇔",
					forall: "∀",
					part: "∂",
					exist: "∃",
					empty: "∅",
					nabla: "∇",
					isin: "∈",
					notin: "∉",
					ni: "∋",
					prod: "∏",
					sum: "∑",
					minus: "−",
					lowast: "∗",
					radic: "√",
					prop: "∝",
					infin: "∞",
					ang: "∠",
					and: "∧",
					or: "∨",
					cap: "∩",
					cup: "∪",
					int: "∫",
					there4: "∴",
					sim: "∼",
					cong: "≅",
					asymp: "≈",
					ne: "≠",
					equiv: "≡",
					le: "≤",
					ge: "≥",
					sub: "⊂",
					sup: "⊃",
					nsub: "⊄",
					sube: "⊆",
					supe: "⊇",
					oplus: "⊕",
					otimes: "⊗",
					perp: "⊥",
					sdot: "⋅",
					lceil: "⌈",
					rceil: "⌉",
					lfloor: "⌊",
					rfloor: "⌋",
					loz: "◊",
					spades: "♠",
					clubs: "♣",
					hearts: "♥",
					diams: "♦",
					lang: "⟨",
					rang: "⟩"
				};
			},
			function(module, exports, __webpack_require__) {
				"use strict";
				Object.defineProperty(exports, "__esModule", { value: true });
				var error_handler_1 = __webpack_require__(10);
				var scanner_1 = __webpack_require__(12);
				var token_1 = __webpack_require__(13);
				var Reader = function() {
					function Reader() {
						this.values = [];
						this.curly = this.paren = -1;
					}
					Reader.prototype.beforeFunctionExpression = function(t) {
						return [
							"(",
							"{",
							"[",
							"in",
							"typeof",
							"instanceof",
							"new",
							"return",
							"case",
							"delete",
							"throw",
							"void",
							"=",
							"+=",
							"-=",
							"*=",
							"**=",
							"/=",
							"%=",
							"<<=",
							">>=",
							">>>=",
							"&=",
							"|=",
							"^=",
							",",
							"+",
							"-",
							"*",
							"**",
							"/",
							"%",
							"++",
							"--",
							"<<",
							">>",
							">>>",
							"&",
							"|",
							"^",
							"!",
							"~",
							"&&",
							"||",
							"?",
							":",
							"===",
							"==",
							">=",
							"<=",
							"<",
							">",
							"!=",
							"!=="
						].indexOf(t) >= 0;
					};
					Reader.prototype.isRegexStart = function() {
						var previous = this.values[this.values.length - 1];
						var regex = previous !== null;
						switch (previous) {
							case "this":
							case "]":
								regex = false;
								break;
							case ")":
								var keyword = this.values[this.paren - 1];
								regex = keyword === "if" || keyword === "while" || keyword === "for" || keyword === "with";
								break;
							case "}":
								regex = false;
								if (this.values[this.curly - 3] === "function") {
									var check = this.values[this.curly - 4];
									regex = check ? !this.beforeFunctionExpression(check) : false;
								} else if (this.values[this.curly - 4] === "function") {
									var check = this.values[this.curly - 5];
									regex = check ? !this.beforeFunctionExpression(check) : true;
								}
						}
						return regex;
					};
					Reader.prototype.push = function(token) {
						if (token.type === 7 || token.type === 4) {
							if (token.value === "{") this.curly = this.values.length;
							else if (token.value === "(") this.paren = this.values.length;
							this.values.push(token.value);
						} else this.values.push(null);
					};
					return Reader;
				}();
				exports.Tokenizer = function() {
					function Tokenizer(code, config) {
						this.errorHandler = new error_handler_1.ErrorHandler();
						this.errorHandler.tolerant = config ? typeof config.tolerant === "boolean" && config.tolerant : false;
						this.scanner = new scanner_1.Scanner(code, this.errorHandler);
						this.scanner.trackComment = config ? typeof config.comment === "boolean" && config.comment : false;
						this.trackRange = config ? typeof config.range === "boolean" && config.range : false;
						this.trackLoc = config ? typeof config.loc === "boolean" && config.loc : false;
						this.buffer = [];
						this.reader = new Reader();
					}
					Tokenizer.prototype.errors = function() {
						return this.errorHandler.errors;
					};
					Tokenizer.prototype.getNextToken = function() {
						if (this.buffer.length === 0) {
							var comments = this.scanner.scanComments();
							if (this.scanner.trackComment) for (var i = 0; i < comments.length; ++i) {
								var e = comments[i];
								var value = this.scanner.source.slice(e.slice[0], e.slice[1]);
								var comment = {
									type: e.multiLine ? "BlockComment" : "LineComment",
									value
								};
								if (this.trackRange) comment.range = e.range;
								if (this.trackLoc) comment.loc = e.loc;
								this.buffer.push(comment);
							}
							if (!this.scanner.eof()) {
								var loc = void 0;
								if (this.trackLoc) loc = {
									start: {
										line: this.scanner.lineNumber,
										column: this.scanner.index - this.scanner.lineStart
									},
									end: {}
								};
								var token = this.scanner.source[this.scanner.index] === "/" && this.reader.isRegexStart() ? this.scanner.scanRegExp() : this.scanner.lex();
								this.reader.push(token);
								var entry = {
									type: token_1.TokenName[token.type],
									value: this.scanner.source.slice(token.start, token.end)
								};
								if (this.trackRange) entry.range = [token.start, token.end];
								if (this.trackLoc) {
									loc.end = {
										line: this.scanner.lineNumber,
										column: this.scanner.index - this.scanner.lineStart
									};
									entry.loc = loc;
								}
								if (token.type === 9) entry.regex = {
									pattern: token.pattern,
									flags: token.flags
								};
								this.buffer.push(entry);
							}
						}
						return this.buffer.shift();
					};
					return Tokenizer;
				}();
			}
		]);
	});
}));
// node_modules/js-yaml/lib/js-yaml/type/js/function.js
var require_function = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var esprima;
	try {
		esprima = require_esprima();
	} catch (_) {
		if (typeof window !== "undefined") esprima = window.esprima;
	}
	var Type = require_type();
	function resolveJavascriptFunction(data) {
		if (data === null) return false;
		try {
			var source = "(" + data + ")", ast = esprima.parse(source, { range: true });
			if (ast.type !== "Program" || ast.body.length !== 1 || ast.body[0].type !== "ExpressionStatement" || ast.body[0].expression.type !== "ArrowFunctionExpression" && ast.body[0].expression.type !== "FunctionExpression") return false;
			return true;
		} catch (err) {
			return false;
		}
	}
	function constructJavascriptFunction(data) {
		var source = "(" + data + ")", ast = esprima.parse(source, { range: true }), params = [], body;
		if (ast.type !== "Program" || ast.body.length !== 1 || ast.body[0].type !== "ExpressionStatement" || ast.body[0].expression.type !== "ArrowFunctionExpression" && ast.body[0].expression.type !== "FunctionExpression") throw new Error("Failed to resolve function");
		ast.body[0].expression.params.forEach(function(param) {
			params.push(param.name);
		});
		body = ast.body[0].expression.body.range;
		if (ast.body[0].expression.body.type === "BlockStatement") return new Function(params, source.slice(body[0] + 1, body[1] - 1));
		return new Function(params, "return " + source.slice(body[0], body[1]));
	}
	function representJavascriptFunction(object) {
		return object.toString();
	}
	function isFunction(object) {
		return Object.prototype.toString.call(object) === "[object Function]";
	}
	module.exports = new Type("tag:yaml.org,2002:js/function", {
		kind: "scalar",
		resolve: resolveJavascriptFunction,
		construct: constructJavascriptFunction,
		predicate: isFunction,
		represent: representJavascriptFunction
	});
}));
// node_modules/js-yaml/lib/js-yaml/schema/default_full.js
var require_default_full = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Schema = require_schema();
	module.exports = Schema.DEFAULT = new Schema({
		include: [require_default_safe()],
		explicit: [
			require_undefined(),
			require_regexp(),
			require_function()
		]
	});
}));
// node_modules/js-yaml/lib/js-yaml/loader.js
var require_loader = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var common = require_common();
	var YAMLException = require_exception();
	var Mark = require_mark();
	var DEFAULT_SAFE_SCHEMA = require_default_safe();
	var DEFAULT_FULL_SCHEMA = require_default_full();
	var _hasOwnProperty = Object.prototype.hasOwnProperty;
	var CONTEXT_FLOW_IN = 1;
	var CONTEXT_FLOW_OUT = 2;
	var CONTEXT_BLOCK_IN = 3;
	var CONTEXT_BLOCK_OUT = 4;
	var CHOMPING_CLIP = 1;
	var CHOMPING_STRIP = 2;
	var CHOMPING_KEEP = 3;
	var PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
	var PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
	var PATTERN_FLOW_INDICATORS = /[,\[\]\{\}]/;
	var PATTERN_TAG_HANDLE = /^(?:!|!!|![a-z\-]+!)$/i;
	var PATTERN_TAG_URI = /^(?:!|[^,\[\]\{\}])(?:%[0-9a-f]{2}|[0-9a-z\-#;\/\?:@&=\+\$,_\.!~\*'\(\)\[\]])*$/i;
	function _class(obj) {
		return Object.prototype.toString.call(obj);
	}
	function is_EOL(c) {
		return c === 10 || c === 13;
	}
	function is_WHITE_SPACE(c) {
		return c === 9 || c === 32;
	}
	function is_WS_OR_EOL(c) {
		return c === 9 || c === 32 || c === 10 || c === 13;
	}
	function is_FLOW_INDICATOR(c) {
		return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
	}
	function fromHexCode(c) {
		var lc;
		if (48 <= c && c <= 57) return c - 48;
		lc = c | 32;
		if (97 <= lc && lc <= 102) return lc - 97 + 10;
		return -1;
	}
	function escapedHexLen(c) {
		if (c === 120) return 2;
		if (c === 117) return 4;
		if (c === 85) return 8;
		return 0;
	}
	function fromDecimalCode(c) {
		if (48 <= c && c <= 57) return c - 48;
		return -1;
	}
	function simpleEscapeSequence(c) {
		return c === 48 ? "\0" : c === 97 ? "\x07" : c === 98 ? "\b" : c === 116 ? "	" : c === 9 ? "	" : c === 110 ? "\n" : c === 118 ? "\v" : c === 102 ? "\f" : c === 114 ? "\r" : c === 101 ? "\x1B" : c === 32 ? " " : c === 34 ? "\"" : c === 47 ? "/" : c === 92 ? "\\" : c === 78 ? "" : c === 95 ? "\xA0" : c === 76 ? "\u2028" : c === 80 ? "\u2029" : "";
	}
	function charFromCodepoint(c) {
		if (c <= 65535) return String.fromCharCode(c);
		return String.fromCharCode((c - 65536 >> 10) + 55296, (c - 65536 & 1023) + 56320);
	}
	function setProperty(object, key, value) {
		if (key === "__proto__") Object.defineProperty(object, key, {
			configurable: true,
			enumerable: true,
			writable: true,
			value
		});
		else object[key] = value;
	}
	var simpleEscapeCheck = new Array(256);
	var simpleEscapeMap = new Array(256);
	for (var i = 0; i < 256; i++) {
		simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
		simpleEscapeMap[i] = simpleEscapeSequence(i);
	}
	function State(input, options) {
		this.input = input;
		this.filename = options["filename"] || null;
		this.schema = options["schema"] || DEFAULT_FULL_SCHEMA;
		this.onWarning = options["onWarning"] || null;
		this.legacy = options["legacy"] || false;
		this.json = options["json"] || false;
		this.listener = options["listener"] || null;
		this.maxTotalMergeKeys = typeof options["maxTotalMergeKeys"] === "number" ? options["maxTotalMergeKeys"] : 1e4;
		this.implicitTypes = this.schema.compiledImplicit;
		this.typeMap = this.schema.compiledTypeMap;
		this.length = input.length;
		this.position = 0;
		this.line = 0;
		this.lineStart = 0;
		this.lineIndent = 0;
		this.totalMergeKeys = 0;
		this.documents = [];
	}
	function generateError(state, message) {
		return new YAMLException(message, new Mark(state.filename, state.input, state.position, state.line, state.position - state.lineStart));
	}
	function throwError(state, message) {
		throw generateError(state, message);
	}
	function throwWarning(state, message) {
		if (state.onWarning) state.onWarning.call(null, generateError(state, message));
	}
	var directiveHandlers = {
		YAML: function handleYamlDirective(state, name, args) {
			var match, major, minor;
			if (state.version !== null) throwError(state, "duplication of %YAML directive");
			if (args.length !== 1) throwError(state, "YAML directive accepts exactly one argument");
			match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
			if (match === null) throwError(state, "ill-formed argument of the YAML directive");
			major = parseInt(match[1], 10);
			minor = parseInt(match[2], 10);
			if (major !== 1) throwError(state, "unacceptable YAML version of the document");
			state.version = args[0];
			state.checkLineBreaks = minor < 2;
			if (minor !== 1 && minor !== 2) throwWarning(state, "unsupported YAML version of the document");
		},
		TAG: function handleTagDirective(state, name, args) {
			var handle, prefix;
			if (args.length !== 2) throwError(state, "TAG directive accepts exactly two arguments");
			handle = args[0];
			prefix = args[1];
			if (!PATTERN_TAG_HANDLE.test(handle)) throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
			if (_hasOwnProperty.call(state.tagMap, handle)) throwError(state, "there is a previously declared suffix for \"" + handle + "\" tag handle");
			if (!PATTERN_TAG_URI.test(prefix)) throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
			state.tagMap[handle] = prefix;
		}
	};
	function captureSegment(state, start, end, checkJson) {
		var _position, _length, _character, _result;
		if (start < end) {
			_result = state.input.slice(start, end);
			if (checkJson) for (_position = 0, _length = _result.length; _position < _length; _position += 1) {
				_character = _result.charCodeAt(_position);
				if (!(_character === 9 || 32 <= _character && _character <= 1114111)) throwError(state, "expected valid JSON character");
			}
			else if (PATTERN_NON_PRINTABLE.test(_result)) throwError(state, "the stream contains non-printable characters");
			state.result += _result;
		}
	}
	function chargeMergeWork(state) {
		state.totalMergeKeys += 1;
		if (state.maxTotalMergeKeys !== -1 && state.totalMergeKeys > state.maxTotalMergeKeys) throwError(state, "merge keys exceeded maxTotalMergeKeys (" + state.maxTotalMergeKeys + ")");
	}
	function mergeMappings(state, destination, source, overridableKeys) {
		var sourceKeys, key, index, quantity;
		if (!common.isObject(source)) throwError(state, "cannot merge mappings; the provided source object is unacceptable");
		chargeMergeWork(state);
		sourceKeys = Object.keys(source);
		for (index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
			key = sourceKeys[index];
			chargeMergeWork(state);
			if (!_hasOwnProperty.call(destination, key)) {
				setProperty(destination, key, source[key]);
				overridableKeys[key] = true;
			}
		}
	}
	function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startPos) {
		var index, quantity;
		if (Array.isArray(keyNode)) {
			keyNode = Array.prototype.slice.call(keyNode);
			for (index = 0, quantity = keyNode.length; index < quantity; index += 1) {
				if (Array.isArray(keyNode[index])) throwError(state, "nested arrays are not supported inside keys");
				if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") keyNode[index] = "[object Object]";
			}
		}
		if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") keyNode = "[object Object]";
		keyNode = String(keyNode);
		if (_result === null) _result = {};
		if (keyTag === "tag:yaml.org,2002:merge") {
			if (Array.isArray(valueNode)) {
				if (valueNode.length > 100) throwError(state, "abnormal merge sequence size");
				for (index = 0, quantity = valueNode.length; index < quantity; index += 1) mergeMappings(state, _result, valueNode[index], overridableKeys);
			} else mergeMappings(state, _result, valueNode, overridableKeys);
		} else {
			if (!state.json && !_hasOwnProperty.call(overridableKeys, keyNode) && _hasOwnProperty.call(_result, keyNode)) {
				state.line = startLine || state.line;
				state.position = startPos || state.position;
				throwError(state, "duplicated mapping key");
			}
			setProperty(_result, keyNode, valueNode);
			delete overridableKeys[keyNode];
		}
		return _result;
	}
	function readLineBreak(state) {
		var ch = state.input.charCodeAt(state.position);
		if (ch === 10) state.position++;
		else if (ch === 13) {
			state.position++;
			if (state.input.charCodeAt(state.position) === 10) state.position++;
		} else throwError(state, "a line break is expected");
		state.line += 1;
		state.lineStart = state.position;
	}
	function skipSeparationSpace(state, allowComments, checkIndent) {
		var lineBreaks = 0, ch = state.input.charCodeAt(state.position);
		while (ch !== 0) {
			while (is_WHITE_SPACE(ch)) ch = state.input.charCodeAt(++state.position);
			if (allowComments && ch === 35) do
				ch = state.input.charCodeAt(++state.position);
			while (ch !== 10 && ch !== 13 && ch !== 0);
			if (is_EOL(ch)) {
				readLineBreak(state);
				ch = state.input.charCodeAt(state.position);
				lineBreaks++;
				state.lineIndent = 0;
				while (ch === 32) {
					state.lineIndent++;
					ch = state.input.charCodeAt(++state.position);
				}
			} else break;
		}
		if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) throwWarning(state, "deficient indentation");
		return lineBreaks;
	}
	function testDocumentSeparator(state) {
		var _position = state.position, ch = state.input.charCodeAt(_position);
		if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
			_position += 3;
			ch = state.input.charCodeAt(_position);
			if (ch === 0 || is_WS_OR_EOL(ch)) return true;
		}
		return false;
	}
	function writeFoldedLines(state, count) {
		if (count === 1) state.result += " ";
		else if (count > 1) state.result += common.repeat("\n", count - 1);
	}
	function readPlainScalar(state, nodeIndent, withinFlowCollection) {
		var preceding, following, captureStart, captureEnd, hasPendingContent, _line, _lineStart, _lineIndent, _kind = state.kind, _result = state.result, ch = state.input.charCodeAt(state.position);
		if (is_WS_OR_EOL(ch) || is_FLOW_INDICATOR(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) return false;
		if (ch === 63 || ch === 45) {
			following = state.input.charCodeAt(state.position + 1);
			if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) return false;
		}
		state.kind = "scalar";
		state.result = "";
		captureStart = captureEnd = state.position;
		hasPendingContent = false;
		while (ch !== 0) {
			if (ch === 58) {
				following = state.input.charCodeAt(state.position + 1);
				if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) break;
			} else if (ch === 35) {
				preceding = state.input.charCodeAt(state.position - 1);
				if (is_WS_OR_EOL(preceding)) break;
			} else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && is_FLOW_INDICATOR(ch)) break;
			else if (is_EOL(ch)) {
				_line = state.line;
				_lineStart = state.lineStart;
				_lineIndent = state.lineIndent;
				skipSeparationSpace(state, false, -1);
				if (state.lineIndent >= nodeIndent) {
					hasPendingContent = true;
					ch = state.input.charCodeAt(state.position);
					continue;
				} else {
					state.position = captureEnd;
					state.line = _line;
					state.lineStart = _lineStart;
					state.lineIndent = _lineIndent;
					break;
				}
			}
			if (hasPendingContent) {
				captureSegment(state, captureStart, captureEnd, false);
				writeFoldedLines(state, state.line - _line);
				captureStart = captureEnd = state.position;
				hasPendingContent = false;
			}
			if (!is_WHITE_SPACE(ch)) captureEnd = state.position + 1;
			ch = state.input.charCodeAt(++state.position);
		}
		captureSegment(state, captureStart, captureEnd, false);
		if (state.result) return true;
		state.kind = _kind;
		state.result = _result;
		return false;
	}
	function readSingleQuotedScalar(state, nodeIndent) {
		var ch = state.input.charCodeAt(state.position), captureStart, captureEnd;
		if (ch !== 39) return false;
		state.kind = "scalar";
		state.result = "";
		state.position++;
		captureStart = captureEnd = state.position;
		while ((ch = state.input.charCodeAt(state.position)) !== 0) if (ch === 39) {
			captureSegment(state, captureStart, state.position, true);
			ch = state.input.charCodeAt(++state.position);
			if (ch === 39) {
				captureStart = state.position;
				state.position++;
				captureEnd = state.position;
			} else return true;
		} else if (is_EOL(ch)) {
			captureSegment(state, captureStart, captureEnd, true);
			writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
			captureStart = captureEnd = state.position;
		} else if (state.position === state.lineStart && testDocumentSeparator(state)) throwError(state, "unexpected end of the document within a single quoted scalar");
		else {
			state.position++;
			captureEnd = state.position;
		}
		throwError(state, "unexpected end of the stream within a single quoted scalar");
	}
	function readDoubleQuotedScalar(state, nodeIndent) {
		var captureStart, captureEnd, hexLength, hexResult, tmp, ch = state.input.charCodeAt(state.position);
		if (ch !== 34) return false;
		state.kind = "scalar";
		state.result = "";
		state.position++;
		captureStart = captureEnd = state.position;
		while ((ch = state.input.charCodeAt(state.position)) !== 0) if (ch === 34) {
			captureSegment(state, captureStart, state.position, true);
			state.position++;
			return true;
		} else if (ch === 92) {
			captureSegment(state, captureStart, state.position, true);
			ch = state.input.charCodeAt(++state.position);
			if (is_EOL(ch)) skipSeparationSpace(state, false, nodeIndent);
			else if (ch < 256 && simpleEscapeCheck[ch]) {
				state.result += simpleEscapeMap[ch];
				state.position++;
			} else if ((tmp = escapedHexLen(ch)) > 0) {
				hexLength = tmp;
				hexResult = 0;
				for (; hexLength > 0; hexLength--) {
					ch = state.input.charCodeAt(++state.position);
					if ((tmp = fromHexCode(ch)) >= 0) hexResult = (hexResult << 4) + tmp;
					else throwError(state, "expected hexadecimal character");
				}
				state.result += charFromCodepoint(hexResult);
				state.position++;
			} else throwError(state, "unknown escape sequence");
			captureStart = captureEnd = state.position;
		} else if (is_EOL(ch)) {
			captureSegment(state, captureStart, captureEnd, true);
			writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
			captureStart = captureEnd = state.position;
		} else if (state.position === state.lineStart && testDocumentSeparator(state)) throwError(state, "unexpected end of the document within a double quoted scalar");
		else {
			state.position++;
			captureEnd = state.position;
		}
		throwError(state, "unexpected end of the stream within a double quoted scalar");
	}
	function readFlowCollection(state, nodeIndent) {
		var readNext = true, _line, _tag = state.tag, _result, _anchor = state.anchor, following, terminator, isPair, isExplicitPair, isMapping, overridableKeys = {}, keyNode, keyTag, valueNode, ch = state.input.charCodeAt(state.position);
		if (ch === 91) {
			terminator = 93;
			isMapping = false;
			_result = [];
		} else if (ch === 123) {
			terminator = 125;
			isMapping = true;
			_result = {};
		} else return false;
		if (state.anchor !== null) state.anchorMap[state.anchor] = _result;
		ch = state.input.charCodeAt(++state.position);
		while (ch !== 0) {
			skipSeparationSpace(state, true, nodeIndent);
			ch = state.input.charCodeAt(state.position);
			if (ch === terminator) {
				state.position++;
				state.tag = _tag;
				state.anchor = _anchor;
				state.kind = isMapping ? "mapping" : "sequence";
				state.result = _result;
				return true;
			} else if (!readNext) throwError(state, "missed comma between flow collection entries");
			keyTag = keyNode = valueNode = null;
			isPair = isExplicitPair = false;
			if (ch === 63) {
				following = state.input.charCodeAt(state.position + 1);
				if (is_WS_OR_EOL(following)) {
					isPair = isExplicitPair = true;
					state.position++;
					skipSeparationSpace(state, true, nodeIndent);
				}
			}
			_line = state.line;
			composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
			keyTag = state.tag;
			keyNode = state.result;
			skipSeparationSpace(state, true, nodeIndent);
			ch = state.input.charCodeAt(state.position);
			if ((isExplicitPair || state.line === _line) && ch === 58) {
				isPair = true;
				ch = state.input.charCodeAt(++state.position);
				skipSeparationSpace(state, true, nodeIndent);
				composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
				valueNode = state.result;
			}
			if (isMapping) storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode);
			else if (isPair) _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode));
			else _result.push(keyNode);
			skipSeparationSpace(state, true, nodeIndent);
			ch = state.input.charCodeAt(state.position);
			if (ch === 44) {
				readNext = true;
				ch = state.input.charCodeAt(++state.position);
			} else readNext = false;
		}
		throwError(state, "unexpected end of the stream within a flow collection");
	}
	function readBlockScalar(state, nodeIndent) {
		var captureStart, folding, chomping = CHOMPING_CLIP, didReadContent = false, detectedIndent = false, textIndent = nodeIndent, emptyLines = 0, atMoreIndented = false, tmp, ch = state.input.charCodeAt(state.position);
		if (ch === 124) folding = false;
		else if (ch === 62) folding = true;
		else return false;
		state.kind = "scalar";
		state.result = "";
		while (ch !== 0) {
			ch = state.input.charCodeAt(++state.position);
			if (ch === 43 || ch === 45) {
				if (CHOMPING_CLIP === chomping) chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
				else throwError(state, "repeat of a chomping mode identifier");
			} else if ((tmp = fromDecimalCode(ch)) >= 0) {
				if (tmp === 0) throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
				else if (!detectedIndent) {
					textIndent = nodeIndent + tmp - 1;
					detectedIndent = true;
				} else throwError(state, "repeat of an indentation width identifier");
			} else break;
		}
		if (is_WHITE_SPACE(ch)) {
			do
				ch = state.input.charCodeAt(++state.position);
			while (is_WHITE_SPACE(ch));
			if (ch === 35) do
				ch = state.input.charCodeAt(++state.position);
			while (!is_EOL(ch) && ch !== 0);
		}
		while (ch !== 0) {
			readLineBreak(state);
			state.lineIndent = 0;
			ch = state.input.charCodeAt(state.position);
			while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
				state.lineIndent++;
				ch = state.input.charCodeAt(++state.position);
			}
			if (!detectedIndent && state.lineIndent > textIndent) textIndent = state.lineIndent;
			if (is_EOL(ch)) {
				emptyLines++;
				continue;
			}
			if (state.lineIndent < textIndent) {
				if (chomping === CHOMPING_KEEP) state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
				else if (chomping === CHOMPING_CLIP) {
					if (didReadContent) state.result += "\n";
				}
				break;
			}
			if (folding) {
				if (is_WHITE_SPACE(ch)) {
					atMoreIndented = true;
					state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
				} else if (atMoreIndented) {
					atMoreIndented = false;
					state.result += common.repeat("\n", emptyLines + 1);
				} else if (emptyLines === 0) {
					if (didReadContent) state.result += " ";
				} else state.result += common.repeat("\n", emptyLines);
			} else state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
			didReadContent = true;
			detectedIndent = true;
			emptyLines = 0;
			captureStart = state.position;
			while (!is_EOL(ch) && ch !== 0) ch = state.input.charCodeAt(++state.position);
			captureSegment(state, captureStart, state.position, false);
		}
		return true;
	}
	function readBlockSequence(state, nodeIndent) {
		var _line, _tag = state.tag, _anchor = state.anchor, _result = [], following, detected = false, ch;
		if (state.anchor !== null) state.anchorMap[state.anchor] = _result;
		ch = state.input.charCodeAt(state.position);
		while (ch !== 0) {
			if (ch !== 45) break;
			following = state.input.charCodeAt(state.position + 1);
			if (!is_WS_OR_EOL(following)) break;
			detected = true;
			state.position++;
			if (skipSeparationSpace(state, true, -1)) {
				if (state.lineIndent <= nodeIndent) {
					_result.push(null);
					ch = state.input.charCodeAt(state.position);
					continue;
				}
			}
			_line = state.line;
			composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
			_result.push(state.result);
			skipSeparationSpace(state, true, -1);
			ch = state.input.charCodeAt(state.position);
			if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) throwError(state, "bad indentation of a sequence entry");
			else if (state.lineIndent < nodeIndent) break;
		}
		if (detected) {
			state.tag = _tag;
			state.anchor = _anchor;
			state.kind = "sequence";
			state.result = _result;
			return true;
		}
		return false;
	}
	function readBlockMapping(state, nodeIndent, flowIndent) {
		var following, allowCompact, _line, _pos, _tag = state.tag, _anchor = state.anchor, _result = {}, overridableKeys = {}, keyTag = null, keyNode = null, valueNode = null, atExplicitKey = false, detected = false, ch;
		if (state.anchor !== null) state.anchorMap[state.anchor] = _result;
		ch = state.input.charCodeAt(state.position);
		while (ch !== 0) {
			following = state.input.charCodeAt(state.position + 1);
			_line = state.line;
			_pos = state.position;
			if ((ch === 63 || ch === 58) && is_WS_OR_EOL(following)) {
				if (ch === 63) {
					if (atExplicitKey) {
						storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null);
						keyTag = keyNode = valueNode = null;
					}
					detected = true;
					atExplicitKey = true;
					allowCompact = true;
				} else if (atExplicitKey) {
					atExplicitKey = false;
					allowCompact = true;
				} else throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
				state.position += 1;
				ch = following;
			} else if (composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
				if (state.line === _line) {
					ch = state.input.charCodeAt(state.position);
					while (is_WHITE_SPACE(ch)) ch = state.input.charCodeAt(++state.position);
					if (ch === 58) {
						ch = state.input.charCodeAt(++state.position);
						if (!is_WS_OR_EOL(ch)) throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
						if (atExplicitKey) {
							storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null);
							keyTag = keyNode = valueNode = null;
						}
						detected = true;
						atExplicitKey = false;
						allowCompact = false;
						keyTag = state.tag;
						keyNode = state.result;
					} else if (detected) throwError(state, "can not read an implicit mapping pair; a colon is missed");
					else {
						state.tag = _tag;
						state.anchor = _anchor;
						return true;
					}
				} else if (detected) throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
				else {
					state.tag = _tag;
					state.anchor = _anchor;
					return true;
				}
			} else break;
			if (state.line === _line || state.lineIndent > nodeIndent) {
				if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
					if (atExplicitKey) keyNode = state.result;
					else valueNode = state.result;
				}
				if (!atExplicitKey) {
					storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _pos);
					keyTag = keyNode = valueNode = null;
				}
				skipSeparationSpace(state, true, -1);
				ch = state.input.charCodeAt(state.position);
			}
			if (state.lineIndent > nodeIndent && ch !== 0) throwError(state, "bad indentation of a mapping entry");
			else if (state.lineIndent < nodeIndent) break;
		}
		if (atExplicitKey) storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null);
		if (detected) {
			state.tag = _tag;
			state.anchor = _anchor;
			state.kind = "mapping";
			state.result = _result;
		}
		return detected;
	}
	function readTagProperty(state) {
		var _position, isVerbatim = false, isNamed = false, tagHandle, tagName, ch = state.input.charCodeAt(state.position);
		if (ch !== 33) return false;
		if (state.tag !== null) throwError(state, "duplication of a tag property");
		ch = state.input.charCodeAt(++state.position);
		if (ch === 60) {
			isVerbatim = true;
			ch = state.input.charCodeAt(++state.position);
		} else if (ch === 33) {
			isNamed = true;
			tagHandle = "!!";
			ch = state.input.charCodeAt(++state.position);
		} else tagHandle = "!";
		_position = state.position;
		if (isVerbatim) {
			do
				ch = state.input.charCodeAt(++state.position);
			while (ch !== 0 && ch !== 62);
			if (state.position < state.length) {
				tagName = state.input.slice(_position, state.position);
				ch = state.input.charCodeAt(++state.position);
			} else throwError(state, "unexpected end of the stream within a verbatim tag");
		} else {
			while (ch !== 0 && !is_WS_OR_EOL(ch)) {
				if (ch === 33) {
					if (!isNamed) {
						tagHandle = state.input.slice(_position - 1, state.position + 1);
						if (!PATTERN_TAG_HANDLE.test(tagHandle)) throwError(state, "named tag handle cannot contain such characters");
						isNamed = true;
						_position = state.position + 1;
					} else throwError(state, "tag suffix cannot contain exclamation marks");
				}
				ch = state.input.charCodeAt(++state.position);
			}
			tagName = state.input.slice(_position, state.position);
			if (PATTERN_FLOW_INDICATORS.test(tagName)) throwError(state, "tag suffix cannot contain flow indicator characters");
		}
		if (tagName && !PATTERN_TAG_URI.test(tagName)) throwError(state, "tag name cannot contain such characters: " + tagName);
		if (isVerbatim) state.tag = tagName;
		else if (_hasOwnProperty.call(state.tagMap, tagHandle)) state.tag = state.tagMap[tagHandle] + tagName;
		else if (tagHandle === "!") state.tag = "!" + tagName;
		else if (tagHandle === "!!") state.tag = "tag:yaml.org,2002:" + tagName;
		else throwError(state, "undeclared tag handle \"" + tagHandle + "\"");
		return true;
	}
	function readAnchorProperty(state) {
		var _position, ch = state.input.charCodeAt(state.position);
		if (ch !== 38) return false;
		if (state.anchor !== null) throwError(state, "duplication of an anchor property");
		ch = state.input.charCodeAt(++state.position);
		_position = state.position;
		while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) ch = state.input.charCodeAt(++state.position);
		if (state.position === _position) throwError(state, "name of an anchor node must contain at least one character");
		state.anchor = state.input.slice(_position, state.position);
		return true;
	}
	function readAlias(state) {
		var _position, alias, ch = state.input.charCodeAt(state.position);
		if (ch !== 42) return false;
		ch = state.input.charCodeAt(++state.position);
		_position = state.position;
		while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) ch = state.input.charCodeAt(++state.position);
		if (state.position === _position) throwError(state, "name of an alias node must contain at least one character");
		alias = state.input.slice(_position, state.position);
		if (!_hasOwnProperty.call(state.anchorMap, alias)) throwError(state, "unidentified alias \"" + alias + "\"");
		state.result = state.anchorMap[alias];
		skipSeparationSpace(state, true, -1);
		return true;
	}
	function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
		var allowBlockStyles, allowBlockScalars, allowBlockCollections, indentStatus = 1, atNewLine = false, hasContent = false, typeIndex, typeQuantity, type, flowIndent, blockIndent;
		if (state.listener !== null) state.listener("open", state);
		state.tag = null;
		state.anchor = null;
		state.kind = null;
		state.result = null;
		allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
		if (allowToSeek) {
			if (skipSeparationSpace(state, true, -1)) {
				atNewLine = true;
				if (state.lineIndent > parentIndent) indentStatus = 1;
				else if (state.lineIndent === parentIndent) indentStatus = 0;
				else if (state.lineIndent < parentIndent) indentStatus = -1;
			}
		}
		if (indentStatus === 1) while (readTagProperty(state) || readAnchorProperty(state)) if (skipSeparationSpace(state, true, -1)) {
			atNewLine = true;
			allowBlockCollections = allowBlockStyles;
			if (state.lineIndent > parentIndent) indentStatus = 1;
			else if (state.lineIndent === parentIndent) indentStatus = 0;
			else if (state.lineIndent < parentIndent) indentStatus = -1;
		} else allowBlockCollections = false;
		if (allowBlockCollections) allowBlockCollections = atNewLine || allowCompact;
		if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
			if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) flowIndent = parentIndent;
			else flowIndent = parentIndent + 1;
			blockIndent = state.position - state.lineStart;
			if (indentStatus === 1) {
				if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) hasContent = true;
				else {
					if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) hasContent = true;
					else if (readAlias(state)) {
						hasContent = true;
						if (state.tag !== null || state.anchor !== null) throwError(state, "alias node should not have any properties");
					} else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
						hasContent = true;
						if (state.tag === null) state.tag = "?";
					}
					if (state.anchor !== null) state.anchorMap[state.anchor] = state.result;
				}
			} else if (indentStatus === 0) hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
		}
		if (state.tag !== null && state.tag !== "!") {
			if (state.tag === "?") {
				if (state.result !== null && state.kind !== "scalar") throwError(state, "unacceptable node kind for !<?> tag; it should be \"scalar\", not \"" + state.kind + "\"");
				for (typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
					type = state.implicitTypes[typeIndex];
					if (type.resolve(state.result)) {
						state.result = type.construct(state.result);
						state.tag = type.tag;
						if (state.anchor !== null) state.anchorMap[state.anchor] = state.result;
						break;
					}
				}
			} else if (_hasOwnProperty.call(state.typeMap[state.kind || "fallback"], state.tag)) {
				type = state.typeMap[state.kind || "fallback"][state.tag];
				if (state.result !== null && type.kind !== state.kind) throwError(state, "unacceptable node kind for !<" + state.tag + "> tag; it should be \"" + type.kind + "\", not \"" + state.kind + "\"");
				if (!type.resolve(state.result)) throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
				else {
					state.result = type.construct(state.result);
					if (state.anchor !== null) state.anchorMap[state.anchor] = state.result;
				}
			} else throwError(state, "unknown tag !<" + state.tag + ">");
		}
		if (state.listener !== null) state.listener("close", state);
		return state.tag !== null || state.anchor !== null || hasContent;
	}
	function readDocument(state) {
		var documentStart = state.position, _position, directiveName, directiveArgs, hasDirectives = false, ch;
		state.version = null;
		state.checkLineBreaks = state.legacy;
		state.tagMap = {};
		state.anchorMap = {};
		while ((ch = state.input.charCodeAt(state.position)) !== 0) {
			skipSeparationSpace(state, true, -1);
			ch = state.input.charCodeAt(state.position);
			if (state.lineIndent > 0 || ch !== 37) break;
			hasDirectives = true;
			ch = state.input.charCodeAt(++state.position);
			_position = state.position;
			while (ch !== 0 && !is_WS_OR_EOL(ch)) ch = state.input.charCodeAt(++state.position);
			directiveName = state.input.slice(_position, state.position);
			directiveArgs = [];
			if (directiveName.length < 1) throwError(state, "directive name must not be less than one character in length");
			while (ch !== 0) {
				while (is_WHITE_SPACE(ch)) ch = state.input.charCodeAt(++state.position);
				if (ch === 35) {
					do
						ch = state.input.charCodeAt(++state.position);
					while (ch !== 0 && !is_EOL(ch));
					break;
				}
				if (is_EOL(ch)) break;
				_position = state.position;
				while (ch !== 0 && !is_WS_OR_EOL(ch)) ch = state.input.charCodeAt(++state.position);
				directiveArgs.push(state.input.slice(_position, state.position));
			}
			if (ch !== 0) readLineBreak(state);
			if (_hasOwnProperty.call(directiveHandlers, directiveName)) directiveHandlers[directiveName](state, directiveName, directiveArgs);
			else throwWarning(state, "unknown document directive \"" + directiveName + "\"");
		}
		skipSeparationSpace(state, true, -1);
		if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
			state.position += 3;
			skipSeparationSpace(state, true, -1);
		} else if (hasDirectives) throwError(state, "directives end mark is expected");
		composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
		skipSeparationSpace(state, true, -1);
		if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) throwWarning(state, "non-ASCII line breaks are interpreted as content");
		state.documents.push(state.result);
		if (state.position === state.lineStart && testDocumentSeparator(state)) {
			if (state.input.charCodeAt(state.position) === 46) {
				state.position += 3;
				skipSeparationSpace(state, true, -1);
			}
			return;
		}
		if (state.position < state.length - 1) throwError(state, "end of the stream or a document separator is expected");
		else return;
	}
	function loadDocuments(input, options) {
		input = String(input);
		options = options || {};
		if (input.length !== 0) {
			if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) input += "\n";
			if (input.charCodeAt(0) === 65279) input = input.slice(1);
		}
		var state = new State(input, options);
		var nullpos = input.indexOf("\0");
		if (nullpos !== -1) {
			state.position = nullpos;
			throwError(state, "null byte is not allowed in input");
		}
		state.input += "\0";
		while (state.input.charCodeAt(state.position) === 32) {
			state.lineIndent += 1;
			state.position += 1;
		}
		while (state.position < state.length - 1) readDocument(state);
		return state.documents;
	}
	function loadAll(input, iterator, options) {
		if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
			options = iterator;
			iterator = null;
		}
		var documents = loadDocuments(input, options);
		if (typeof iterator !== "function") return documents;
		for (var index = 0, length = documents.length; index < length; index += 1) iterator(documents[index]);
	}
	function load(input, options) {
		var documents = loadDocuments(input, options);
		if (documents.length === 0) return;
		else if (documents.length === 1) return documents[0];
		throw new YAMLException("expected a single document in the stream, but found more");
	}
	function safeLoadAll(input, iterator, options) {
		if (typeof iterator === "object" && iterator !== null && typeof options === "undefined") {
			options = iterator;
			iterator = null;
		}
		return loadAll(input, iterator, common.extend({ schema: DEFAULT_SAFE_SCHEMA }, options));
	}
	function safeLoad(input, options) {
		return load(input, common.extend({ schema: DEFAULT_SAFE_SCHEMA }, options));
	}
	module.exports.loadAll = loadAll;
	module.exports.load = load;
	module.exports.safeLoadAll = safeLoadAll;
	module.exports.safeLoad = safeLoad;
}));
// node_modules/js-yaml/lib/js-yaml/dumper.js
var require_dumper = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var common = require_common();
	var YAMLException = require_exception();
	var DEFAULT_FULL_SCHEMA = require_default_full();
	var DEFAULT_SAFE_SCHEMA = require_default_safe();
	var _toString = Object.prototype.toString;
	var _hasOwnProperty = Object.prototype.hasOwnProperty;
	var CHAR_TAB = 9;
	var CHAR_LINE_FEED = 10;
	var CHAR_CARRIAGE_RETURN = 13;
	var CHAR_SPACE = 32;
	var CHAR_EXCLAMATION = 33;
	var CHAR_DOUBLE_QUOTE = 34;
	var CHAR_SHARP = 35;
	var CHAR_PERCENT = 37;
	var CHAR_AMPERSAND = 38;
	var CHAR_SINGLE_QUOTE = 39;
	var CHAR_ASTERISK = 42;
	var CHAR_COMMA = 44;
	var CHAR_MINUS = 45;
	var CHAR_COLON = 58;
	var CHAR_EQUALS = 61;
	var CHAR_GREATER_THAN = 62;
	var CHAR_QUESTION = 63;
	var CHAR_COMMERCIAL_AT = 64;
	var CHAR_LEFT_SQUARE_BRACKET = 91;
	var CHAR_RIGHT_SQUARE_BRACKET = 93;
	var CHAR_GRAVE_ACCENT = 96;
	var CHAR_LEFT_CURLY_BRACKET = 123;
	var CHAR_VERTICAL_LINE = 124;
	var CHAR_RIGHT_CURLY_BRACKET = 125;
	var ESCAPE_SEQUENCES = {};
	ESCAPE_SEQUENCES[0] = "\\0";
	ESCAPE_SEQUENCES[7] = "\\a";
	ESCAPE_SEQUENCES[8] = "\\b";
	ESCAPE_SEQUENCES[9] = "\\t";
	ESCAPE_SEQUENCES[10] = "\\n";
	ESCAPE_SEQUENCES[11] = "\\v";
	ESCAPE_SEQUENCES[12] = "\\f";
	ESCAPE_SEQUENCES[13] = "\\r";
	ESCAPE_SEQUENCES[27] = "\\e";
	ESCAPE_SEQUENCES[34] = "\\\"";
	ESCAPE_SEQUENCES[92] = "\\\\";
	ESCAPE_SEQUENCES[133] = "\\N";
	ESCAPE_SEQUENCES[160] = "\\_";
	ESCAPE_SEQUENCES[8232] = "\\L";
	ESCAPE_SEQUENCES[8233] = "\\P";
	var DEPRECATED_BOOLEANS_SYNTAX = [
		"y",
		"Y",
		"yes",
		"Yes",
		"YES",
		"on",
		"On",
		"ON",
		"n",
		"N",
		"no",
		"No",
		"NO",
		"off",
		"Off",
		"OFF"
	];
	function compileStyleMap(schema, map) {
		var result, keys, index, length, tag, style, type;
		if (map === null) return {};
		result = {};
		keys = Object.keys(map);
		for (index = 0, length = keys.length; index < length; index += 1) {
			tag = keys[index];
			style = String(map[tag]);
			if (tag.slice(0, 2) === "!!") tag = "tag:yaml.org,2002:" + tag.slice(2);
			type = schema.compiledTypeMap["fallback"][tag];
			if (type && _hasOwnProperty.call(type.styleAliases, style)) style = type.styleAliases[style];
			result[tag] = style;
		}
		return result;
	}
	function encodeHex(character) {
		var string = character.toString(16).toUpperCase(), handle, length;
		if (character <= 255) {
			handle = "x";
			length = 2;
		} else if (character <= 65535) {
			handle = "u";
			length = 4;
		} else if (character <= 4294967295) {
			handle = "U";
			length = 8;
		} else throw new YAMLException("code point within a string may not be greater than 0xFFFFFFFF");
		return "\\" + handle + common.repeat("0", length - string.length) + string;
	}
	function State(options) {
		this.schema = options["schema"] || DEFAULT_FULL_SCHEMA;
		this.indent = Math.max(1, options["indent"] || 2);
		this.noArrayIndent = options["noArrayIndent"] || false;
		this.skipInvalid = options["skipInvalid"] || false;
		this.flowLevel = common.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
		this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
		this.sortKeys = options["sortKeys"] || false;
		this.lineWidth = options["lineWidth"] || 80;
		this.noRefs = options["noRefs"] || false;
		this.noCompatMode = options["noCompatMode"] || false;
		this.condenseFlow = options["condenseFlow"] || false;
		this.implicitTypes = this.schema.compiledImplicit;
		this.explicitTypes = this.schema.compiledExplicit;
		this.tag = null;
		this.result = "";
		this.duplicates = [];
		this.usedDuplicates = null;
	}
	function indentString(string, spaces) {
		var ind = common.repeat(" ", spaces), position = 0, next = -1, result = "", line, length = string.length;
		while (position < length) {
			next = string.indexOf("\n", position);
			if (next === -1) {
				line = string.slice(position);
				position = length;
			} else {
				line = string.slice(position, next + 1);
				position = next + 1;
			}
			if (line.length && line !== "\n") result += ind;
			result += line;
		}
		return result;
	}
	function generateNextLine(state, level) {
		return "\n" + common.repeat(" ", state.indent * level);
	}
	function testImplicitResolving(state, str) {
		var index = 0, length = state.implicitTypes.length, type;
		for (; index < length; index += 1) {
			type = state.implicitTypes[index];
			if (type.resolve(str)) return true;
		}
		return false;
	}
	function isWhitespace(c) {
		return c === CHAR_SPACE || c === CHAR_TAB;
	}
	function isPrintable(c) {
		return 32 <= c && c <= 126 || 161 <= c && c <= 55295 && c !== 8232 && c !== 8233 || 57344 <= c && c <= 65533 && c !== 65279 || 65536 <= c && c <= 1114111;
	}
	function isNsChar(c) {
		return isPrintable(c) && !isWhitespace(c) && c !== 65279 && c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
	}
	function isPlainSafe(c, prev) {
		return isPrintable(c) && c !== 65279 && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_COLON && (c !== CHAR_SHARP || prev && isNsChar(prev));
	}
	function isPlainSafeFirst(c) {
		return isPrintable(c) && c !== 65279 && !isWhitespace(c) && c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
	}
	function needIndentIndicator(string) {
		return /^\n* /.test(string);
	}
	var STYLE_PLAIN = 1;
	var STYLE_SINGLE = 2;
	var STYLE_LITERAL = 3;
	var STYLE_FOLDED = 4;
	var STYLE_DOUBLE = 5;
	function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType) {
		var i;
		var char, prev_char;
		var hasLineBreak = false;
		var hasFoldableLine = false;
		var shouldTrackWidth = lineWidth !== -1;
		var previousLineBreak = -1;
		var plain = isPlainSafeFirst(string.charCodeAt(0)) && !isWhitespace(string.charCodeAt(string.length - 1));
		if (singleLineOnly) for (i = 0; i < string.length; i++) {
			char = string.charCodeAt(i);
			if (!isPrintable(char)) return STYLE_DOUBLE;
			prev_char = i > 0 ? string.charCodeAt(i - 1) : null;
			plain = plain && isPlainSafe(char, prev_char);
		}
		else {
			for (i = 0; i < string.length; i++) {
				char = string.charCodeAt(i);
				if (char === CHAR_LINE_FEED) {
					hasLineBreak = true;
					if (shouldTrackWidth) {
						hasFoldableLine = hasFoldableLine || i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
						previousLineBreak = i;
					}
				} else if (!isPrintable(char)) return STYLE_DOUBLE;
				prev_char = i > 0 ? string.charCodeAt(i - 1) : null;
				plain = plain && isPlainSafe(char, prev_char);
			}
			hasFoldableLine = hasFoldableLine || shouldTrackWidth && i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
		}
		if (!hasLineBreak && !hasFoldableLine) return plain && !testAmbiguousType(string) ? STYLE_PLAIN : STYLE_SINGLE;
		if (indentPerLevel > 9 && needIndentIndicator(string)) return STYLE_DOUBLE;
		return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
	}
	function writeScalar(state, string, level, iskey) {
		state.dump = function() {
			if (string.length === 0) return "''";
			if (!state.noCompatMode && DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1) return "'" + string + "'";
			var indent = state.indent * Math.max(1, level);
			var lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
			var singleLineOnly = iskey || state.flowLevel > -1 && level >= state.flowLevel;
			function testAmbiguity(string) {
				return testImplicitResolving(state, string);
			}
			switch (chooseScalarStyle(string, singleLineOnly, state.indent, lineWidth, testAmbiguity)) {
				case STYLE_PLAIN: return string;
				case STYLE_SINGLE: return "'" + string.replace(/'/g, "''") + "'";
				case STYLE_LITERAL: return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
				case STYLE_FOLDED: return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
				case STYLE_DOUBLE: return "\"" + escapeString(string, lineWidth) + "\"";
				default: throw new YAMLException("impossible error: invalid scalar style");
			}
		}();
	}
	function blockHeader(string, indentPerLevel) {
		var indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
		var clip = string[string.length - 1] === "\n";
		return indentIndicator + (clip && (string[string.length - 2] === "\n" || string === "\n") ? "+" : clip ? "" : "-") + "\n";
	}
	function dropEndingNewline(string) {
		return string[string.length - 1] === "\n" ? string.slice(0, -1) : string;
	}
	function foldString(string, width) {
		var lineRe = /(\n+)([^\n]*)/g;
		var result = function() {
			var nextLF = string.indexOf("\n");
			nextLF = nextLF !== -1 ? nextLF : string.length;
			lineRe.lastIndex = nextLF;
			return foldLine(string.slice(0, nextLF), width);
		}();
		var prevMoreIndented = string[0] === "\n" || string[0] === " ";
		var moreIndented;
		var match;
		while (match = lineRe.exec(string)) {
			var prefix = match[1], line = match[2];
			moreIndented = line[0] === " ";
			result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
			prevMoreIndented = moreIndented;
		}
		return result;
	}
	function foldLine(line, width) {
		if (line === "" || line[0] === " ") return line;
		var breakRe = / [^ ]/g;
		var match;
		var start = 0, end, curr = 0, next = 0;
		var result = "";
		while (match = breakRe.exec(line)) {
			next = match.index;
			if (next - start > width) {
				end = curr > start ? curr : next;
				result += "\n" + line.slice(start, end);
				start = end + 1;
			}
			curr = next;
		}
		result += "\n";
		if (line.length - start > width && curr > start) result += line.slice(start, curr) + "\n" + line.slice(curr + 1);
		else result += line.slice(start);
		return result.slice(1);
	}
	function escapeString(string) {
		var result = "";
		var char, nextChar;
		var escapeSeq;
		for (var i = 0; i < string.length; i++) {
			char = string.charCodeAt(i);
			if (char >= 55296 && char <= 56319) {
				nextChar = string.charCodeAt(i + 1);
				if (nextChar >= 56320 && nextChar <= 57343) {
					result += encodeHex((char - 55296) * 1024 + nextChar - 56320 + 65536);
					i++;
					continue;
				}
			}
			escapeSeq = ESCAPE_SEQUENCES[char];
			result += !escapeSeq && isPrintable(char) ? string[i] : escapeSeq || encodeHex(char);
		}
		return result;
	}
	function writeFlowSequence(state, level, object) {
		var _result = "", _tag = state.tag, index = 0, length = object.length;
		for (; index < length; index += 1) if (writeNode(state, level, object[index], false, false)) {
			if (index !== 0) _result += "," + (!state.condenseFlow ? " " : "");
			_result += state.dump;
		}
		state.tag = _tag;
		state.dump = "[" + _result + "]";
	}
	function writeBlockSequence(state, level, object, compact) {
		var _result = "", _tag = state.tag, index = 0, length = object.length;
		for (; index < length; index += 1) if (writeNode(state, level + 1, object[index], true, true)) {
			if (!compact || index !== 0) _result += generateNextLine(state, level);
			if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) _result += "-";
			else _result += "- ";
			_result += state.dump;
		}
		state.tag = _tag;
		state.dump = _result || "[]";
	}
	function writeFlowMapping(state, level, object) {
		var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index = 0, length = objectKeyList.length, objectKey, objectValue, pairBuffer;
		for (; index < length; index += 1) {
			pairBuffer = "";
			if (index !== 0) pairBuffer += ", ";
			if (state.condenseFlow) pairBuffer += "\"";
			objectKey = objectKeyList[index];
			objectValue = object[objectKey];
			if (!writeNode(state, level, objectKey, false, false)) continue;
			if (state.dump.length > 1024) pairBuffer += "? ";
			pairBuffer += state.dump + (state.condenseFlow ? "\"" : "") + ":" + (state.condenseFlow ? "" : " ");
			if (!writeNode(state, level, objectValue, false, false)) continue;
			pairBuffer += state.dump;
			_result += pairBuffer;
		}
		state.tag = _tag;
		state.dump = "{" + _result + "}";
	}
	function writeBlockMapping(state, level, object, compact) {
		var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, explicitPair, pairBuffer;
		if (state.sortKeys === true) objectKeyList.sort();
		else if (typeof state.sortKeys === "function") objectKeyList.sort(state.sortKeys);
		else if (state.sortKeys) throw new YAMLException("sortKeys must be a boolean or a function");
		for (index = 0, length = objectKeyList.length; index < length; index += 1) {
			pairBuffer = "";
			if (!compact || index !== 0) pairBuffer += generateNextLine(state, level);
			objectKey = objectKeyList[index];
			objectValue = object[objectKey];
			if (!writeNode(state, level + 1, objectKey, true, true, true)) continue;
			explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
			if (explicitPair) {
				if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) pairBuffer += "?";
				else pairBuffer += "? ";
			}
			pairBuffer += state.dump;
			if (explicitPair) pairBuffer += generateNextLine(state, level);
			if (!writeNode(state, level + 1, objectValue, true, explicitPair)) continue;
			if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) pairBuffer += ":";
			else pairBuffer += ": ";
			pairBuffer += state.dump;
			_result += pairBuffer;
		}
		state.tag = _tag;
		state.dump = _result || "{}";
	}
	function detectType(state, object, explicit) {
		var _result, typeList = explicit ? state.explicitTypes : state.implicitTypes, index = 0, length = typeList.length, type, style;
		for (; index < length; index += 1) {
			type = typeList[index];
			if ((type.instanceOf || type.predicate) && (!type.instanceOf || typeof object === "object" && object instanceof type.instanceOf) && (!type.predicate || type.predicate(object))) {
				state.tag = explicit ? type.tag : "?";
				if (type.represent) {
					style = state.styleMap[type.tag] || type.defaultStyle;
					if (_toString.call(type.represent) === "[object Function]") _result = type.represent(object, style);
					else if (_hasOwnProperty.call(type.represent, style)) _result = type.represent[style](object, style);
					else throw new YAMLException("!<" + type.tag + "> tag resolver accepts not \"" + style + "\" style");
					state.dump = _result;
				}
				return true;
			}
		}
		return false;
	}
	function writeNode(state, level, object, block, compact, iskey) {
		state.tag = null;
		state.dump = object;
		if (!detectType(state, object, false)) detectType(state, object, true);
		var type = _toString.call(state.dump);
		if (block) block = state.flowLevel < 0 || state.flowLevel > level;
		var objectOrArray = type === "[object Object]" || type === "[object Array]", duplicateIndex, duplicate;
		if (objectOrArray) {
			duplicateIndex = state.duplicates.indexOf(object);
			duplicate = duplicateIndex !== -1;
		}
		if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) compact = false;
		if (duplicate && state.usedDuplicates[duplicateIndex]) state.dump = "*ref_" + duplicateIndex;
		else {
			if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) state.usedDuplicates[duplicateIndex] = true;
			if (type === "[object Object]") {
				if (block && Object.keys(state.dump).length !== 0) {
					writeBlockMapping(state, level, state.dump, compact);
					if (duplicate) state.dump = "&ref_" + duplicateIndex + state.dump;
				} else {
					writeFlowMapping(state, level, state.dump);
					if (duplicate) state.dump = "&ref_" + duplicateIndex + " " + state.dump;
				}
			} else if (type === "[object Array]") {
				var arrayLevel = state.noArrayIndent && level > 0 ? level - 1 : level;
				if (block && state.dump.length !== 0) {
					writeBlockSequence(state, arrayLevel, state.dump, compact);
					if (duplicate) state.dump = "&ref_" + duplicateIndex + state.dump;
				} else {
					writeFlowSequence(state, arrayLevel, state.dump);
					if (duplicate) state.dump = "&ref_" + duplicateIndex + " " + state.dump;
				}
			} else if (type === "[object String]") {
				if (state.tag !== "?") writeScalar(state, state.dump, level, iskey);
			} else {
				if (state.skipInvalid) return false;
				throw new YAMLException("unacceptable kind of an object to dump " + type);
			}
			if (state.tag !== null && state.tag !== "?") state.dump = "!<" + state.tag + "> " + state.dump;
		}
		return true;
	}
	function getDuplicateReferences(object, state) {
		var objects = [], duplicatesIndexes = [], index, length;
		inspectNode(object, objects, duplicatesIndexes);
		for (index = 0, length = duplicatesIndexes.length; index < length; index += 1) state.duplicates.push(objects[duplicatesIndexes[index]]);
		state.usedDuplicates = new Array(length);
	}
	function inspectNode(object, objects, duplicatesIndexes) {
		var objectKeyList, index, length;
		if (object !== null && typeof object === "object") {
			index = objects.indexOf(object);
			if (index !== -1) {
				if (duplicatesIndexes.indexOf(index) === -1) duplicatesIndexes.push(index);
			} else {
				objects.push(object);
				if (Array.isArray(object)) for (index = 0, length = object.length; index < length; index += 1) inspectNode(object[index], objects, duplicatesIndexes);
				else {
					objectKeyList = Object.keys(object);
					for (index = 0, length = objectKeyList.length; index < length; index += 1) inspectNode(object[objectKeyList[index]], objects, duplicatesIndexes);
				}
			}
		}
	}
	function dump(input, options) {
		options = options || {};
		var state = new State(options);
		if (!state.noRefs) getDuplicateReferences(input, state);
		if (writeNode(state, 0, input, true, true)) return state.dump + "\n";
		return "";
	}
	function safeDump(input, options) {
		return dump(input, common.extend({ schema: DEFAULT_SAFE_SCHEMA }, options));
	}
	module.exports.dump = dump;
	module.exports.safeDump = safeDump;
}));
// node_modules/js-yaml/lib/js-yaml.js
var require_js_yaml$1 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var loader = require_loader();
	var dumper = require_dumper();
	function deprecated(name) {
		return function() {
			throw new Error("Function " + name + " is deprecated and cannot be used.");
		};
	}
	module.exports.Type = require_type();
	module.exports.Schema = require_schema();
	module.exports.FAILSAFE_SCHEMA = require_failsafe();
	module.exports.JSON_SCHEMA = require_json();
	module.exports.CORE_SCHEMA = require_core();
	module.exports.DEFAULT_SAFE_SCHEMA = require_default_safe();
	module.exports.DEFAULT_FULL_SCHEMA = require_default_full();
	module.exports.load = loader.load;
	module.exports.loadAll = loader.loadAll;
	module.exports.safeLoad = loader.safeLoad;
	module.exports.safeLoadAll = loader.safeLoadAll;
	module.exports.dump = dumper.dump;
	module.exports.safeDump = dumper.safeDump;
	module.exports.YAMLException = require_exception();
	module.exports.MINIMAL_SCHEMA = require_failsafe();
	module.exports.SAFE_SCHEMA = require_default_safe();
	module.exports.DEFAULT_SCHEMA = require_default_full();
	module.exports.scan = deprecated("scan");
	module.exports.parse = deprecated("parse");
	module.exports.compose = deprecated("compose");
	module.exports.addConstructor = deprecated("addConstructor");
}));
// node_modules/js-yaml/index.js
var require_js_yaml = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = require_js_yaml$1();
}));
// src/rules/frontmatter.ts
var import_front_matter = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports, module) => {
	var parser = require_js_yaml();
	var optionalByteOrderMark = "\\ufeff?";
	var platform = typeof process !== "undefined" ? process.platform : "";
	var pattern = "^(" + optionalByteOrderMark + "(= yaml =|---)$([\\s\\S]*?)^(?:\\2|\\.\\.\\.)\\s*$" + (platform === "win32" ? "\\r?" : "") + "(?:\\n)?)";
	var regex = new RegExp(pattern, "m");
	module.exports = extractor;
	module.exports.test = test;
	function extractor(string, options) {
		string = string || "";
		var defaultOptions = { allowUnsafe: false };
		options = options instanceof Object ? {
			...defaultOptions,
			...options
		} : defaultOptions;
		options.allowUnsafe = Boolean(options.allowUnsafe);
		var lines = string.split(/(\r?\n)/);
		if (lines[0] && /= yaml =|---/.test(lines[0])) return parse(string, options.allowUnsafe);
		else return {
			attributes: {},
			body: string,
			bodyBegin: 1
		};
	}
	function computeLocation(match, body) {
		var line = 1;
		var pos = body.indexOf("\n");
		var offset = match.index + match[0].length;
		while (pos !== -1) {
			if (pos >= offset) return line;
			line++;
			pos = body.indexOf("\n", pos + 1);
		}
		return line;
	}
	function parse(string, allowUnsafe) {
		var match = regex.exec(string);
		if (!match) return {
			attributes: {},
			body: string,
			bodyBegin: 1
		};
		var loader = allowUnsafe ? parser.load : parser.safeLoad;
		var yaml = match[match.length - 1].replace(/^\s+|\s+$/g, "");
		return {
			attributes: loader(yaml) || {},
			body: string.replace(match[0], ""),
			bodyBegin: computeLocation(match, string),
			frontmatter: yaml
		};
	}
	function test(string) {
		string = string || "";
		return regex.test(string);
	}
})))(), 1);
var FrontmatterError = class extends Error {};
function emptyMetadata() {
	return {
		alwaysApply: false,
		globs: []
	};
}
/** Parse rule metadata; malformed metadata never partially applies. */
function parseFrontmatter(raw, source) {
	try {
		const { attributes, body } = (0, import_front_matter.default)(raw);
		return {
			metadata: parseMetadata(attributes),
			body,
			diagnostics: []
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			metadata: emptyMetadata(),
			body: raw,
			diagnostics: [{
				severity: "warning",
				code: "invalid-frontmatter",
				source,
				message: `Invalid frontmatter: ${message}`
			}]
		};
	}
}
function parseMetadata(value) {
	if (!isMapping(value)) throw new FrontmatterError("Rule metadata must be a mapping.");
	const metadata = emptyMetadata();
	if (Object.hasOwn(value, "alwaysApply")) {
		if (typeof value.alwaysApply !== "boolean") throw new FrontmatterError("alwaysApply must be a boolean.");
		metadata.alwaysApply = value.alwaysApply;
	}
	if (Object.hasOwn(value, "description")) {
		if (typeof value.description !== "string") throw new FrontmatterError("description must be a string.");
		metadata.description = value.description;
	}
	if (Object.hasOwn(value, "globs")) metadata.globs = normalizeGlobs(value.globs);
	return metadata;
}
function isMapping(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
function normalizeGlobs(value) {
	const patterns = typeof value === "string" ? [value] : value;
	if (!Array.isArray(patterns) || !patterns.every((pattern) => typeof pattern === "string")) throw new FrontmatterError("globs must be a string or string array.");
	return [...new Set(patterns.map((pattern) => pattern.replaceAll("\\", "/").trim()).filter(Boolean))];
}
// src/rules/discovery.ts
var excludedDirectories = /* @__PURE__ */ new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".turbo",
	".next",
	"coverage"
]);
var sources = [".pi/rules", "~/.pi/rules"];
function missing(error) {
	const code = error.code;
	return code === "ENOENT" || code === "ENOTDIR";
}
function message(error) {
	return error instanceof Error ? error.message : String(error);
}
function compareString(a, b) {
	return a < b ? -1 : a > b ? 1 : 0;
}
function compareCandidates(a, b) {
	return Number(a.isGlobal) - Number(b.isGlobal) || compareString(a.relativePath, b.relativePath) || compareString(a.realPath, b.realPath);
}
function discoverRules(options, knownCandidates = []) {
	const started = performance.now();
	const fs = options.fs ?? nodeFs;
	const stats = {
		scans: 0,
		reads: 0,
		parses: 0,
		hashes: 0,
		durationMs: 0
	};
	const diagnostics = [];
	const diagnosticKeys = /* @__PURE__ */ new Set();
	const observations = [];
	const scans = /* @__PURE__ */ new Map();
	const realpaths = /* @__PURE__ */ new Map();
	const reads = /* @__PURE__ */ new Map();
	const projectContainment = /* @__PURE__ */ new Map();
	const candidates = /* @__PURE__ */ new Map();
	const allowed = new Set(options.allowlist ?? sources);
	function addDiagnostic(diagnostic) {
		const key = JSON.stringify([
			diagnostic.code,
			diagnostic.source,
			diagnostic.message
		]);
		if (diagnosticKeys.has(key)) return;
		diagnosticKeys.add(key);
		diagnostics.push(diagnostic);
	}
	function warn(code, source, text) {
		addDiagnostic({
			severity: "warning",
			code,
			source,
			message: text
		});
	}
	function realpath(input) {
		let result = realpaths.get(input);
		if (!result) {
			try {
				result = { value: slash(fs.realpathSync(input)) };
			} catch (error) {
				result = { error };
			}
			realpaths.set(input, result);
		}
		if ("error" in result) throw result.error;
		return result.value;
	}
	function withinProject(root, target) {
		const cached = projectContainment.get(target);
		if (cached !== void 0) return cached;
		const result = isWithin(root, target);
		projectContainment.set(target, result);
		return result;
	}
	function scan(realRoot) {
		const cached = scans.get(realRoot);
		if (cached) return cached;
		const result = {
			entries: [],
			pruned: []
		};
		scans.set(realRoot, result);
		stats.scans++;
		try {
			result.entries = fs.globSync("**/*.mdc", {
				cwd: realRoot,
				withFileTypes: true,
				exclude: (entry) => {
					if (!entry.isDirectory()) return false;
					if (excludedDirectories.has(entry.name)) return true;
					const relative = slash(path.relative(realRoot, path.join(entry.parentPath, entry.name)));
					if (relative.split("/").length <= 10) return false;
					result.pruned.push(relative);
					return true;
				}
			});
		} catch (error) {
			result.error = error;
		}
		return result;
	}
	for (const source of sources) {
		if (!allowed.has(source)) continue;
		const isGlobal = source === "~/.pi/rules";
		const base = path.resolve(isGlobal ? options.homeDir : options.sessionRoot);
		const sourceRoot = slash(path.join(base, ".pi", "rules"));
		let boundary;
		let realRoot;
		try {
			boundary = physicalPath(base, process.cwd(), fs);
			realRoot = realpath(sourceRoot);
			if (!isGlobal && !withinProject(boundary, realRoot)) {
				warn("outside-project", sourceRoot, "Project rule source resolves outside the session root.");
				continue;
			}
			if (!fs.statSync(realRoot).isDirectory()) {
				warn("scan-failed", sourceRoot, "Rule source is not a directory.");
				continue;
			}
		} catch (error) {
			if (!missing(error)) warn("scan-failed", sourceRoot, message(error));
			continue;
		}
		const scanned = scan(realRoot);
		if (scanned.error) warn("scan-failed", sourceRoot, message(scanned.error));
		for (const relative of scanned.pruned) warn("scan-depth-limit", slash(path.join(sourceRoot, relative)), "Rule directory exceeds depth 10.");
		const discoveredPaths = /* @__PURE__ */ new Set();
		for (const entry of scanned.entries) {
			if (!entry.isFile() && !entry.isSymbolicLink()) continue;
			const relative = path.relative(realRoot, path.join(entry.parentPath, entry.name));
			discoveredPaths.add(slash(path.resolve(sourceRoot, relative)));
		}
		for (const known of knownCandidates) if (known.source === source) discoveredPaths.add(slash(path.resolve(known.discoveredPath)));
		for (const discoveredPath of discoveredPaths) {
			if (!isWithin(sourceRoot, discoveredPath)) continue;
			const relative = slash(path.relative(sourceRoot, discoveredPath));
			const directories = relative.split("/").slice(0, -1);
			if (!relative.endsWith(".mdc") || directories.some((part) => excludedDirectories.has(part))) continue;
			if (directories.length > 10) {
				warn("scan-depth-limit", slash(path.join(sourceRoot, ...directories.slice(0, 11))), "Rule directory exceeds depth 10.");
				continue;
			}
			const candidate = {
				discoveredPath,
				realPath: discoveredPath,
				source,
				relativePath: slash(path.relative(base, discoveredPath)),
				isGlobal
			};
			try {
				const entry = fs.lstatSync(discoveredPath);
				if (!entry.isFile() && !entry.isSymbolicLink()) continue;
				candidate.realPath = realpath(discoveredPath);
				if (!isGlobal && !withinProject(boundary, candidate.realPath)) {
					warn("outside-project", discoveredPath, "Project rule file resolves outside the session root.");
					continue;
				}
				if (entry.isSymbolicLink() && !fs.statSync(candidate.realPath).isFile()) continue;
			} catch (error) {
				if (!missing(error)) {
					warn("read-failed", discoveredPath, message(error));
					observations.push({
						...candidate,
						error: message(error)
					});
				}
				continue;
			}
			candidates.set(`${source}\0${discoveredPath}`, candidate);
		}
	}
	function load(candidate) {
		let raw;
		stats.reads++;
		try {
			raw = fs.readFileSync(candidate.realPath, "utf8");
		} catch (error) {
			return { error };
		}
		stats.parses++;
		const parsed = parseFrontmatter(raw, candidate.discoveredPath);
		for (const diagnostic of parsed.diagnostics) addDiagnostic(diagnostic);
		stats.hashes++;
		const contentHash = createHash("sha256").update(raw).digest("hex");
		return { content: {
			metadata: parsed.metadata,
			body: parsed.body,
			contentHash,
			ruleKey: `${candidate.realPath}\0${contentHash}`
		} };
	}
	for (const candidate of [...candidates.values()].sort(compareCandidates)) {
		let result = reads.get(candidate.realPath);
		if (!result) {
			result = load(candidate);
			reads.set(candidate.realPath, result);
		}
		if ("content" in result) observations.push({
			...candidate,
			rule: {
				...candidate,
				...result.content
			}
		});
		else {
			warn("read-failed", candidate.discoveredPath, message(result.error));
			if (!missing(result.error)) observations.push({
				...candidate,
				error: message(result.error)
			});
		}
	}
	observations.sort(compareCandidates);
	stats.durationMs = performance.now() - started;
	return {
		observations,
		diagnostics,
		stats
	};
}
// src/rules/formatter.ts
var OPEN = "<pi_rules>\n";
var CLOSE = "\n</pi_rules>";
var RULE_CLOSE = "\n</rule>";
/** Format in caller-supplied priority order; only included entries spend budget. */
function formatRules(rules, config) {
	const included = [];
	const omitted = [];
	const diagnostics = [];
	const entries = [];
	let remaining = config.maxResultChars - 11 - 12;
	for (const rule of rules) {
		const header = `<rule source="${escapeSourceAttribute(rule.discoveredPath)}">\n`;
		const separatorLength = included.length === 0 ? 0 : 2;
		const wrapperLength = header.length + 8;
		const capacity = Math.min(config.maxRuleChars, remaining - wrapperLength - separatorLength);
		let body = rule.body;
		let truncated = false;
		if (capacity >= 0 && body.length > capacity) {
			const notice = `\n\n[Rule truncated. Read full rule: ${rule.discoveredPath}]`;
			let end = Math.max(0, capacity - notice.length);
			if (end > 0 && isHighSurrogate(body.charCodeAt(end - 1)) && isLowSurrogate(body.charCodeAt(end))) end -= 1;
			if (end > 0) {
				body = body.slice(0, end) + notice;
				truncated = true;
			}
		}
		if (capacity < 0 || body.length > capacity) {
			omitted.push(rule);
			diagnostics.push({
				severity: "warning",
				code: "rule-omitted",
				source: rule.discoveredPath,
				message: "Rule omitted because its wrapper or minimum body does not fit the character budgets."
			});
			continue;
		}
		entries.push(header + body + RULE_CLOSE);
		remaining -= separatorLength + wrapperLength + body.length;
		included.push({
			rule,
			truncated
		});
		if (truncated) diagnostics.push({
			severity: "warning",
			code: "rule-truncated",
			source: rule.discoveredPath,
			message: "Rule truncated to fit the character budgets; the full-rule notice is included."
		});
	}
	return {
		text: entries.length === 0 ? "" : OPEN + entries.join("\n\n") + CLOSE,
		included,
		omitted,
		diagnostics
	};
}
function escapeSourceAttribute(source) {
	return source.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function isHighSurrogate(code) {
	return code >= 55296 && code <= 56319;
}
function isLowSurrogate(code) {
	return code >= 56320 && code <= 57343;
}
// node_modules/picomatch/lib/constants.js
var require_constants = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var WIN_SLASH = "\\\\/";
	var WIN_NO_SLASH = `[^${WIN_SLASH}]`;
	var DEFAULT_MAX_EXTGLOB_RECURSION = 0;
	/**
	* Posix glob regex
	*/
	var DOT_LITERAL = "\\.";
	var PLUS_LITERAL = "\\+";
	var QMARK_LITERAL = "\\?";
	var SLASH_LITERAL = "\\/";
	var ONE_CHAR = "(?=.)";
	var QMARK = "[^/]";
	var END_ANCHOR = `(?:${SLASH_LITERAL}|$)`;
	var START_ANCHOR = `(?:^|${SLASH_LITERAL})`;
	var DOTS_SLASH = `${DOT_LITERAL}{1,2}${END_ANCHOR}`;
	var POSIX_CHARS = {
		DOT_LITERAL,
		PLUS_LITERAL,
		QMARK_LITERAL,
		SLASH_LITERAL,
		ONE_CHAR,
		QMARK,
		END_ANCHOR,
		DOTS_SLASH,
		NO_DOT: `(?!${DOT_LITERAL})`,
		NO_DOTS: `(?!${START_ANCHOR}${DOTS_SLASH})`,
		NO_DOT_SLASH: `(?!${DOT_LITERAL}{0,1}${END_ANCHOR})`,
		NO_DOTS_SLASH: `(?!${DOTS_SLASH})`,
		QMARK_NO_DOT: `[^.${SLASH_LITERAL}]`,
		STAR: `${QMARK}*?`,
		START_ANCHOR,
		SEP: "/"
	};
	/**
	* Windows glob regex
	*/
	var WINDOWS_CHARS = {
		...POSIX_CHARS,
		SLASH_LITERAL: `[${WIN_SLASH}]`,
		QMARK: WIN_NO_SLASH,
		STAR: `${WIN_NO_SLASH}*?`,
		DOTS_SLASH: `${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$)`,
		NO_DOT: `(?!${DOT_LITERAL})`,
		NO_DOTS: `(?!(?:^|[${WIN_SLASH}])${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$))`,
		NO_DOT_SLASH: `(?!${DOT_LITERAL}{0,1}(?:[${WIN_SLASH}]|$))`,
		NO_DOTS_SLASH: `(?!${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$))`,
		QMARK_NO_DOT: `[^.${WIN_SLASH}]`,
		START_ANCHOR: `(?:^|[${WIN_SLASH}])`,
		END_ANCHOR: `(?:[${WIN_SLASH}]|$)`,
		SEP: "\\"
	};
	module.exports = {
		DEFAULT_MAX_EXTGLOB_RECURSION,
		MAX_LENGTH: 65536,
		POSIX_REGEX_SOURCE: {
			__proto__: null,
			alnum: "a-zA-Z0-9",
			alpha: "a-zA-Z",
			ascii: "\\x00-\\x7F",
			blank: " \\t",
			cntrl: "\\x00-\\x1F\\x7F",
			digit: "0-9",
			graph: "\\x21-\\x7E",
			lower: "a-z",
			print: "\\x20-\\x7E ",
			punct: "\\-!\"#$%&'()\\*+,./:;<=>?@[\\]^_`{|}~",
			space: " \\t\\r\\n\\v\\f",
			upper: "A-Z",
			word: "A-Za-z0-9_",
			xdigit: "A-Fa-f0-9"
		},
		REGEX_BACKSLASH: /\\(?![*+?^${}(|)[\]])/g,
		REGEX_NON_SPECIAL_CHARS: /^[^@![\].,$*+?^{}()|\\/]+/,
		REGEX_SPECIAL_CHARS: /[-*+?.^${}(|)[\]]/,
		REGEX_SPECIAL_CHARS_BACKREF: /(\\?)((\W)(\3*))/g,
		REGEX_SPECIAL_CHARS_GLOBAL: /([-*+?.^${}(|)[\]])/g,
		REGEX_REMOVE_BACKSLASH: /(?:\[.*?[^\\]\]|\\(?=.))/g,
		REPLACEMENTS: {
			__proto__: null,
			"***": "*",
			"**/**": "**",
			"**/**/**": "**"
		},
		CHAR_0: 48,
		CHAR_9: 57,
		CHAR_UPPERCASE_A: 65,
		CHAR_LOWERCASE_A: 97,
		CHAR_UPPERCASE_Z: 90,
		CHAR_LOWERCASE_Z: 122,
		CHAR_LEFT_PARENTHESES: 40,
		CHAR_RIGHT_PARENTHESES: 41,
		CHAR_ASTERISK: 42,
		CHAR_AMPERSAND: 38,
		CHAR_AT: 64,
		CHAR_BACKWARD_SLASH: 92,
		CHAR_CARRIAGE_RETURN: 13,
		CHAR_CIRCUMFLEX_ACCENT: 94,
		CHAR_COLON: 58,
		CHAR_COMMA: 44,
		CHAR_DOT: 46,
		CHAR_DOUBLE_QUOTE: 34,
		CHAR_EQUAL: 61,
		CHAR_EXCLAMATION_MARK: 33,
		CHAR_FORM_FEED: 12,
		CHAR_FORWARD_SLASH: 47,
		CHAR_GRAVE_ACCENT: 96,
		CHAR_HASH: 35,
		CHAR_HYPHEN_MINUS: 45,
		CHAR_LEFT_ANGLE_BRACKET: 60,
		CHAR_LEFT_CURLY_BRACE: 123,
		CHAR_LEFT_SQUARE_BRACKET: 91,
		CHAR_LINE_FEED: 10,
		CHAR_NO_BREAK_SPACE: 160,
		CHAR_PERCENT: 37,
		CHAR_PLUS: 43,
		CHAR_QUESTION_MARK: 63,
		CHAR_RIGHT_ANGLE_BRACKET: 62,
		CHAR_RIGHT_CURLY_BRACE: 125,
		CHAR_RIGHT_SQUARE_BRACKET: 93,
		CHAR_SEMICOLON: 59,
		CHAR_SINGLE_QUOTE: 39,
		CHAR_SPACE: 32,
		CHAR_TAB: 9,
		CHAR_UNDERSCORE: 95,
		CHAR_VERTICAL_LINE: 124,
		CHAR_ZERO_WIDTH_NOBREAK_SPACE: 65279,
		/**
		* Create EXTGLOB_CHARS
		*/
		extglobChars(chars) {
			return {
				"!": {
					type: "negate",
					open: "(?:(?!(?:",
					close: `))${chars.STAR})`
				},
				"?": {
					type: "qmark",
					open: "(?:",
					close: ")?"
				},
				"+": {
					type: "plus",
					open: "(?:",
					close: ")+"
				},
				"*": {
					type: "star",
					open: "(?:",
					close: ")*"
				},
				"@": {
					type: "at",
					open: "(?:",
					close: ")"
				}
			};
		},
		/**
		* Create GLOB_CHARS
		*/
		globChars(win32) {
			return win32 === true ? WINDOWS_CHARS : POSIX_CHARS;
		}
	};
}));
// node_modules/picomatch/lib/utils.js
var require_utils = /* @__PURE__ */ __commonJSMin(((exports) => {
	var { REGEX_BACKSLASH, REGEX_REMOVE_BACKSLASH, REGEX_SPECIAL_CHARS, REGEX_SPECIAL_CHARS_GLOBAL } = require_constants();
	exports.isObject = (val) => val !== null && typeof val === "object" && !Array.isArray(val);
	exports.hasRegexChars = (str) => REGEX_SPECIAL_CHARS.test(str);
	exports.isRegexChar = (str) => str.length === 1 && exports.hasRegexChars(str);
	exports.escapeRegex = (str) => str.replace(REGEX_SPECIAL_CHARS_GLOBAL, "\\$1");
	exports.toPosixSlashes = (str) => str.replace(REGEX_BACKSLASH, "/");
	exports.isWindows = () => {
		if (typeof navigator !== "undefined" && navigator.platform) {
			const platform = navigator.platform.toLowerCase();
			return platform === "win32" || platform === "windows";
		}
		if (typeof process !== "undefined" && process.platform) return process.platform === "win32";
		return false;
	};
	exports.removeBackslashes = (str) => {
		return str.replace(REGEX_REMOVE_BACKSLASH, (match) => {
			return match === "\\" ? "" : match;
		});
	};
	exports.escapeLast = (input, char, lastIdx) => {
		const idx = input.lastIndexOf(char, lastIdx);
		if (idx === -1) return input;
		if (input[idx - 1] === "\\") return exports.escapeLast(input, char, idx - 1);
		return `${input.slice(0, idx)}\\${input.slice(idx)}`;
	};
	exports.removePrefix = (input, state = {}) => {
		let output = input;
		if (output.startsWith("./")) {
			output = output.slice(2);
			state.prefix = "./";
		}
		return output;
	};
	exports.wrapOutput = (input, state = {}, options = {}) => {
		let output = `${options.contains ? "" : "^"}(?:${input})${options.contains ? "" : "$"}`;
		if (state.negated === true) output = `(?:^(?!${output}).*$)`;
		return output;
	};
	exports.basename = (path, { windows } = {}) => {
		const segs = path.split(windows ? /[\\/]/ : "/");
		const last = segs[segs.length - 1];
		if (last === "") return segs[segs.length - 2];
		return last;
	};
}));
// node_modules/picomatch/lib/scan.js
var require_scan = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var utils = require_utils();
	var { CHAR_ASTERISK, CHAR_AT, CHAR_BACKWARD_SLASH, CHAR_COMMA, CHAR_DOT, CHAR_EXCLAMATION_MARK, CHAR_FORWARD_SLASH, CHAR_LEFT_CURLY_BRACE, CHAR_LEFT_PARENTHESES, CHAR_LEFT_SQUARE_BRACKET, CHAR_PLUS, CHAR_QUESTION_MARK, CHAR_RIGHT_CURLY_BRACE, CHAR_RIGHT_PARENTHESES, CHAR_RIGHT_SQUARE_BRACKET } = require_constants();
	var isPathSeparator = (code) => {
		return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
	};
	var depth = (token) => {
		if (token.isPrefix !== true) token.depth = token.isGlobstar ? Infinity : 1;
	};
	/**
	* Quickly scans a glob pattern and returns an object with a handful of
	* useful properties, like `isGlob`, `path` (the leading non-glob, if it exists),
	* `glob` (the actual pattern), `negated` (true if the path starts with `!` but not
	* with `!(`) and `negatedExtglob` (true if the path starts with `!(`).
	*
	* ```js
	* const pm = require('picomatch');
	* console.log(pm.scan('foo/bar/*.js'));
	* { isGlob: true, input: 'foo/bar/*.js', base: 'foo/bar', glob: '*.js' }
	* ```
	* @param {String} `str`
	* @param {Object} `options`
	* @return {Object} Returns an object with tokens and regex source string.
	* @api public
	*/
	var scan = (input, options) => {
		const opts = options || {};
		const length = input.length - 1;
		const scanToEnd = opts.parts === true || opts.tokens === true || opts.scanToEnd === true;
		const slashes = [];
		const tokens = [];
		const parts = [];
		let str = input;
		let index = -1;
		let start = 0;
		let lastIndex = 0;
		let isBrace = false;
		let isBracket = false;
		let isGlob = false;
		let isExtglob = false;
		let isGlobstar = false;
		let braceEscaped = false;
		let backslashes = false;
		let negated = false;
		let negatedExtglob = false;
		let finished = false;
		let braces = 0;
		let prev;
		let code;
		let token = {
			value: "",
			depth: 0,
			isGlob: false
		};
		const eos = () => index >= length;
		const peek = () => str.charCodeAt(index + 1);
		const advance = () => {
			prev = code;
			return str.charCodeAt(++index);
		};
		while (index < length) {
			code = advance();
			let next;
			if (code === CHAR_BACKWARD_SLASH) {
				backslashes = token.backslashes = true;
				code = advance();
				if (code === CHAR_LEFT_CURLY_BRACE) braceEscaped = true;
				continue;
			}
			if (braceEscaped === true || code === CHAR_LEFT_CURLY_BRACE) {
				braces++;
				while (eos() !== true && (code = advance())) {
					if (code === CHAR_BACKWARD_SLASH) {
						backslashes = token.backslashes = true;
						advance();
						continue;
					}
					if (code === CHAR_LEFT_CURLY_BRACE) {
						braces++;
						continue;
					}
					if (braceEscaped !== true && code === CHAR_DOT && (code = advance()) === CHAR_DOT) {
						isBrace = token.isBrace = true;
						isGlob = token.isGlob = true;
						finished = true;
						if (scanToEnd === true) continue;
						break;
					}
					if (braceEscaped !== true && code === CHAR_COMMA) {
						isBrace = token.isBrace = true;
						isGlob = token.isGlob = true;
						finished = true;
						if (scanToEnd === true) continue;
						break;
					}
					if (code === CHAR_RIGHT_CURLY_BRACE) {
						braces--;
						if (braces === 0) {
							braceEscaped = false;
							isBrace = token.isBrace = true;
							finished = true;
							break;
						}
					}
				}
				if (scanToEnd === true) continue;
				break;
			}
			if (code === CHAR_FORWARD_SLASH) {
				slashes.push(index);
				tokens.push(token);
				token = {
					value: "",
					depth: 0,
					isGlob: false
				};
				if (finished === true) continue;
				if (prev === CHAR_DOT && index === start + 1) {
					start += 2;
					continue;
				}
				lastIndex = index + 1;
				continue;
			}
			if (opts.noext !== true) {
				if ((code === CHAR_PLUS || code === CHAR_AT || code === CHAR_ASTERISK || code === CHAR_QUESTION_MARK || code === CHAR_EXCLAMATION_MARK) === true && peek() === CHAR_LEFT_PARENTHESES) {
					isGlob = token.isGlob = true;
					isExtglob = token.isExtglob = true;
					finished = true;
					if (code === CHAR_EXCLAMATION_MARK && index === start) negatedExtglob = true;
					if (scanToEnd === true) {
						let parens = 0;
						while (eos() !== true && (code = advance())) {
							if (code === CHAR_BACKWARD_SLASH) {
								backslashes = token.backslashes = true;
								advance();
								continue;
							}
							if (code === CHAR_LEFT_PARENTHESES) {
								parens++;
								continue;
							}
							if (code === CHAR_RIGHT_PARENTHESES && --parens === 0) {
								finished = true;
								break;
							}
						}
						continue;
					}
					break;
				}
			}
			if (code === CHAR_ASTERISK) {
				if (prev === CHAR_ASTERISK) isGlobstar = token.isGlobstar = true;
				isGlob = token.isGlob = true;
				finished = true;
				if (scanToEnd === true) continue;
				break;
			}
			if (code === CHAR_QUESTION_MARK) {
				isGlob = token.isGlob = true;
				finished = true;
				if (scanToEnd === true) continue;
				break;
			}
			if (code === CHAR_LEFT_SQUARE_BRACKET) {
				while (eos() !== true && (next = advance())) {
					if (next === CHAR_BACKWARD_SLASH) {
						backslashes = token.backslashes = true;
						advance();
						continue;
					}
					if (next === CHAR_RIGHT_SQUARE_BRACKET) {
						isBracket = token.isBracket = true;
						isGlob = token.isGlob = true;
						finished = true;
						break;
					}
				}
				if (scanToEnd === true) continue;
				break;
			}
			if (opts.nonegate !== true && code === CHAR_EXCLAMATION_MARK && index === start) {
				negated = token.negated = true;
				start++;
				continue;
			}
			if (opts.noparen !== true && code === CHAR_LEFT_PARENTHESES) {
				isGlob = token.isGlob = true;
				if (scanToEnd === true) {
					let parens = 1;
					while (eos() !== true && (code = advance())) {
						if (code === CHAR_BACKWARD_SLASH) {
							backslashes = token.backslashes = true;
							advance();
							continue;
						}
						if (code === CHAR_LEFT_PARENTHESES) {
							parens++;
							continue;
						}
						if (code === CHAR_RIGHT_PARENTHESES && --parens === 0) {
							finished = true;
							break;
						}
					}
					continue;
				}
				break;
			}
			if (isGlob === true) {
				finished = true;
				if (scanToEnd === true) continue;
				break;
			}
		}
		if (opts.noext === true) {
			isExtglob = false;
			isGlob = false;
		}
		let base = str;
		let prefix = "";
		let glob = "";
		if (start > 0) {
			prefix = str.slice(0, start);
			str = str.slice(start);
			lastIndex -= start;
		}
		if (base && isGlob === true && lastIndex > 0) {
			base = str.slice(0, lastIndex);
			glob = str.slice(lastIndex);
		} else if (isGlob === true) {
			base = "";
			glob = str;
		} else base = str;
		if (base && base !== "" && base !== "/" && base !== str) {
			if (isPathSeparator(base.charCodeAt(base.length - 1))) base = base.slice(0, -1);
		}
		if (opts.unescape === true) {
			if (glob) glob = utils.removeBackslashes(glob);
			if (base && backslashes === true) base = utils.removeBackslashes(base);
		}
		const state = {
			prefix,
			input,
			start,
			base,
			glob,
			isBrace,
			isBracket,
			isGlob,
			isExtglob,
			isGlobstar,
			negated,
			negatedExtglob
		};
		if (opts.tokens === true) {
			state.maxDepth = 0;
			if (!isPathSeparator(code)) tokens.push(token);
			state.tokens = tokens;
		}
		if (opts.parts === true || opts.tokens === true) {
			let prevIndex;
			for (let idx = 0; idx < slashes.length; idx++) {
				const n = prevIndex !== void 0 ? prevIndex + 1 : start;
				const i = slashes[idx];
				const value = input.slice(n, i);
				if (opts.tokens) {
					if (idx === 0 && start !== 0) {
						tokens[idx].isPrefix = true;
						tokens[idx].value = prefix;
					} else tokens[idx].value = value;
					depth(tokens[idx]);
					state.maxDepth += tokens[idx].depth;
				}
				if (i >= start) {
					parts.push(value);
					prevIndex = i;
				}
			}
			const n = prevIndex !== void 0 ? prevIndex + 1 : start;
			const value = input.slice(n);
			parts.push(value);
			if (opts.tokens && prevIndex && prevIndex + 1 < input.length) {
				tokens[tokens.length - 1].value = value;
				depth(tokens[tokens.length - 1]);
				state.maxDepth += tokens[tokens.length - 1].depth;
			}
			state.slashes = slashes;
			state.parts = parts;
		}
		return state;
	};
	module.exports = scan;
}));
// node_modules/picomatch/lib/parse.js
var require_parse = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var constants = require_constants();
	var utils = require_utils();
	/**
	* Constants
	*/
	var { MAX_LENGTH, POSIX_REGEX_SOURCE, REGEX_NON_SPECIAL_CHARS, REGEX_SPECIAL_CHARS_BACKREF, REPLACEMENTS } = constants;
	/**
	* Helpers
	*/
	var expandRange = (args, options) => {
		if (typeof options.expandRange === "function") return options.expandRange(...args, options);
		args.sort();
		const value = `[${args.join("-")}]`;
		try {
			new RegExp(value);
		} catch (ex) {
			return args.map((v) => utils.escapeRegex(v)).join("..");
		}
		return value;
	};
	/**
	* Create the message for a syntax error
	*/
	var syntaxError = (type, char) => {
		return `Missing ${type}: "${char}" - use "\\\\${char}" to match literal characters`;
	};
	var splitTopLevel = (input) => {
		const parts = [];
		let bracket = 0;
		let paren = 0;
		let quote = 0;
		let value = "";
		let escaped = false;
		for (const ch of input) {
			if (escaped === true) {
				value += ch;
				escaped = false;
				continue;
			}
			if (ch === "\\") {
				value += ch;
				escaped = true;
				continue;
			}
			if (ch === "\"") {
				quote = quote === 1 ? 0 : 1;
				value += ch;
				continue;
			}
			if (quote === 0) {
				if (ch === "[") bracket++;
				else if (ch === "]" && bracket > 0) bracket--;
				else if (bracket === 0) {
					if (ch === "(") paren++;
					else if (ch === ")" && paren > 0) paren--;
					else if (ch === "|" && paren === 0) {
						parts.push(value);
						value = "";
						continue;
					}
				}
			}
			value += ch;
		}
		parts.push(value);
		return parts;
	};
	var isPlainBranch = (branch) => {
		let escaped = false;
		for (const ch of branch) {
			if (escaped === true) {
				escaped = false;
				continue;
			}
			if (ch === "\\") {
				escaped = true;
				continue;
			}
			if (/[?*+@!()[\]{}]/.test(ch)) return false;
		}
		return true;
	};
	var normalizeSimpleBranch = (branch) => {
		let value = branch.trim();
		let changed = true;
		while (changed === true) {
			changed = false;
			if (/^@\([^\\()[\]{}|]+\)$/.test(value)) {
				value = value.slice(2, -1);
				changed = true;
			}
		}
		if (!isPlainBranch(value)) return;
		return value.replace(/\\(.)/g, "$1");
	};
	var hasRepeatedCharPrefixOverlap = (branches) => {
		const values = branches.map(normalizeSimpleBranch).filter(Boolean);
		for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) {
			const a = values[i];
			const b = values[j];
			const char = a[0];
			if (!char || a !== char.repeat(a.length) || b !== char.repeat(b.length)) continue;
			if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
		}
		return false;
	};
	var parseRepeatedExtglob = (pattern, requireEnd = true) => {
		if (pattern[0] !== "+" && pattern[0] !== "*" || pattern[1] !== "(") return;
		let bracket = 0;
		let paren = 0;
		let quote = 0;
		let escaped = false;
		for (let i = 1; i < pattern.length; i++) {
			const ch = pattern[i];
			if (escaped === true) {
				escaped = false;
				continue;
			}
			if (ch === "\\") {
				escaped = true;
				continue;
			}
			if (ch === "\"") {
				quote = quote === 1 ? 0 : 1;
				continue;
			}
			if (quote === 1) continue;
			if (ch === "[") {
				bracket++;
				continue;
			}
			if (ch === "]" && bracket > 0) {
				bracket--;
				continue;
			}
			if (bracket > 0) continue;
			if (ch === "(") {
				paren++;
				continue;
			}
			if (ch === ")") {
				paren--;
				if (paren === 0) {
					if (requireEnd === true && i !== pattern.length - 1) return;
					return {
						type: pattern[0],
						body: pattern.slice(2, i),
						end: i
					};
				}
			}
		}
	};
	var buildCharClassStar = (chars) => {
		return `${chars.length === 1 ? utils.escapeRegex(chars[0]) : `[${chars.map((ch) => utils.escapeRegex(ch)).join("")}]`}*`;
	};
	var getStarExtglobSequenceChars = (pattern) => {
		let index = 0;
		const chars = [];
		while (index < pattern.length) {
			const match = parseRepeatedExtglob(pattern.slice(index), false);
			if (!match || match.type !== "*") return;
			const branches = splitTopLevel(match.body).map((branch) => branch.trim());
			if (branches.length !== 1) return;
			const branch = normalizeSimpleBranch(branches[0]);
			if (!branch || branch.length !== 1) return;
			chars.push(branch);
			index += match.end + 1;
		}
		if (chars.length < 1) return;
		return chars;
	};
	var repeatedExtglobRecursion = (pattern) => {
		let depth = 0;
		let value = pattern.trim();
		let match = parseRepeatedExtglob(value);
		while (match) {
			depth++;
			value = match.body.trim();
			match = parseRepeatedExtglob(value);
		}
		return depth;
	};
	var analyzeRepeatedExtglob = (body, options) => {
		if (options.maxExtglobRecursion === false) return { risky: false };
		const max = typeof options.maxExtglobRecursion === "number" ? options.maxExtglobRecursion : constants.DEFAULT_MAX_EXTGLOB_RECURSION;
		const branches = splitTopLevel(body).map((branch) => branch.trim());
		if (branches.length > 1) {
			if (branches.some((branch) => branch === "") || branches.some((branch) => /^[*?]+$/.test(branch)) || hasRepeatedCharPrefixOverlap(branches)) return { risky: true };
		}
		const safeChars = [];
		let sawStarSequence = false;
		let combinable = true;
		for (const branch of branches) {
			const chars = getStarExtglobSequenceChars(branch);
			if (chars) {
				sawStarSequence = true;
				safeChars.push(...chars);
				continue;
			}
			const literal = normalizeSimpleBranch(branch);
			if (literal && literal.length === 1) {
				safeChars.push(literal);
				continue;
			}
			combinable = false;
			if (repeatedExtglobRecursion(branch) > max) return { risky: true };
		}
		if (sawStarSequence) return combinable ? {
			risky: true,
			safeOutput: buildCharClassStar([...new Set(safeChars)])
		} : { risky: true };
		return { risky: false };
	};
	/**
	* Parse the given input string.
	* @param {String} input
	* @param {Object} options
	* @return {Object}
	*/
	var parse = (input, options) => {
		if (typeof input !== "string") throw new TypeError("Expected a string");
		input = REPLACEMENTS[input] || input;
		const opts = { ...options };
		const max = typeof opts.maxLength === "number" ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
		let len = input.length;
		if (len > max) throw new SyntaxError(`Input length: ${len}, exceeds maximum allowed length: ${max}`);
		const bos = {
			type: "bos",
			value: "",
			output: opts.prepend || ""
		};
		const tokens = [bos];
		const capture = opts.capture ? "" : "?:";
		const PLATFORM_CHARS = constants.globChars(opts.windows);
		const EXTGLOB_CHARS = constants.extglobChars(PLATFORM_CHARS);
		const { DOT_LITERAL, PLUS_LITERAL, SLASH_LITERAL, ONE_CHAR, DOTS_SLASH, NO_DOT, NO_DOT_SLASH, NO_DOTS_SLASH, QMARK, QMARK_NO_DOT, STAR, START_ANCHOR } = PLATFORM_CHARS;
		const globstar = (opts) => {
			return `(${capture}(?:(?!${START_ANCHOR}${opts.dot ? DOTS_SLASH : DOT_LITERAL}).)*?)`;
		};
		const nodot = opts.dot ? "" : NO_DOT;
		const qmarkNoDot = opts.dot ? QMARK : QMARK_NO_DOT;
		let star = opts.bash === true ? globstar(opts) : STAR;
		if (opts.capture) star = `(${star})`;
		if (typeof opts.noext === "boolean") opts.noextglob = opts.noext;
		const state = {
			input,
			index: -1,
			start: 0,
			dot: opts.dot === true,
			consumed: "",
			output: "",
			prefix: "",
			backtrack: false,
			negated: false,
			brackets: 0,
			braces: 0,
			parens: 0,
			quotes: 0,
			globstar: false,
			tokens
		};
		input = utils.removePrefix(input, state);
		len = input.length;
		const extglobs = [];
		const braces = [];
		const stack = [];
		let prev = bos;
		let value;
		/**
		* Tokenizing helpers
		*/
		const eos = () => state.index === len - 1;
		const peek = state.peek = (n = 1) => input[state.index + n];
		const advance = state.advance = () => input[++state.index] || "";
		const remaining = () => input.slice(state.index + 1);
		const consume = (value = "", num = 0) => {
			state.consumed += value;
			state.index += num;
		};
		const append = (token) => {
			state.output += token.output != null ? token.output : token.value;
			consume(token.value);
		};
		const negate = () => {
			let count = 1;
			while (peek() === "!" && (peek(2) !== "(" || peek(3) === "?")) {
				advance();
				state.start++;
				count++;
			}
			if (count % 2 === 0) return false;
			state.negated = true;
			state.start++;
			return true;
		};
		const increment = (type) => {
			state[type]++;
			stack.push(type);
		};
		const decrement = (type) => {
			state[type]--;
			stack.pop();
		};
		/**
		* Push tokens onto the tokens array. This helper speeds up
		* tokenizing by 1) helping us avoid backtracking as much as possible,
		* and 2) helping us avoid creating extra tokens when consecutive
		* characters are plain text. This improves performance and simplifies
		* lookbehinds.
		*/
		const push = (tok) => {
			if (prev.type === "globstar") {
				const isBrace = state.braces > 0 && (tok.type === "comma" || tok.type === "brace");
				const isExtglob = tok.extglob === true || extglobs.length && (tok.type === "pipe" || tok.type === "paren");
				if (tok.type !== "slash" && tok.type !== "paren" && !isBrace && !isExtglob) {
					state.output = state.output.slice(0, -prev.output.length);
					prev.type = "star";
					prev.value = "*";
					prev.output = star;
					state.output += prev.output;
				}
			}
			if (extglobs.length && tok.type !== "paren") extglobs[extglobs.length - 1].inner += tok.value;
			if (tok.value || tok.output) append(tok);
			if (prev && prev.type === "text" && tok.type === "text") {
				prev.output = (prev.output || prev.value) + tok.value;
				prev.value += tok.value;
				return;
			}
			tok.prev = prev;
			tokens.push(tok);
			prev = tok;
		};
		const extglobOpen = (type, value) => {
			const token = {
				...EXTGLOB_CHARS[value],
				conditions: 1,
				inner: ""
			};
			token.prev = prev;
			token.parens = state.parens;
			token.output = state.output;
			token.startIndex = state.index;
			token.tokensIndex = tokens.length;
			const output = (opts.capture ? "(" : "") + token.open;
			increment("parens");
			push({
				type,
				value,
				output: state.output ? "" : ONE_CHAR
			});
			push({
				type: "paren",
				extglob: true,
				value: advance(),
				output
			});
			extglobs.push(token);
		};
		const extglobClose = (token) => {
			const literal = input.slice(token.startIndex, state.index + 1);
			const analysis = analyzeRepeatedExtglob(input.slice(token.startIndex + 2, state.index), opts);
			if ((token.type === "plus" || token.type === "star") && analysis.risky) {
				const safeOutput = analysis.safeOutput ? (token.output ? "" : ONE_CHAR) + (opts.capture ? `(${analysis.safeOutput})` : analysis.safeOutput) : void 0;
				const open = tokens[token.tokensIndex];
				open.type = "text";
				open.value = literal;
				open.output = safeOutput || utils.escapeRegex(literal);
				for (let i = token.tokensIndex + 1; i < tokens.length; i++) {
					tokens[i].value = "";
					tokens[i].output = "";
					delete tokens[i].suffix;
				}
				state.output = token.output + open.output;
				state.backtrack = true;
				push({
					type: "paren",
					extglob: true,
					value,
					output: ""
				});
				decrement("parens");
				return;
			}
			let output = token.close + (opts.capture ? ")" : "");
			let rest;
			if (token.type === "negate") {
				let extglobStar = star;
				if (token.inner && token.inner.length > 1 && token.inner.includes("/")) extglobStar = globstar(opts);
				if (extglobStar !== star || eos() || /^\)+$/.test(remaining())) output = token.close = `)$))${extglobStar}`;
				if (token.inner.includes("*") && (rest = remaining()) && /^\.[^\\/.]+$/.test(rest)) output = token.close = `)${parse(rest, {
					...options,
					fastpaths: false
				}).output})${extglobStar})`;
				if (token.prev.type === "bos") state.negatedExtglob = true;
			}
			push({
				type: "paren",
				extglob: true,
				value,
				output
			});
			decrement("parens");
		};
		/**
		* Fast paths
		*/
		if (opts.fastpaths !== false && !/(^[*!]|[/()[\]{}"])/.test(input)) {
			let backslashes = false;
			let output = input.replace(REGEX_SPECIAL_CHARS_BACKREF, (m, esc, chars, first, rest, index) => {
				if (first === "\\") {
					backslashes = true;
					return m;
				}
				if (first === "?") {
					if (esc) return esc + first + (rest ? QMARK.repeat(rest.length) : "");
					if (index === 0) return qmarkNoDot + (rest ? QMARK.repeat(rest.length) : "");
					return QMARK.repeat(chars.length);
				}
				if (first === ".") return DOT_LITERAL.repeat(chars.length);
				if (first === "*") {
					if (esc) return esc + first + (rest ? star : "");
					return star;
				}
				return esc ? m : `\\${m}`;
			});
			if (backslashes === true) {
				if (opts.unescape === true) output = output.replace(/\\/g, "");
				else output = output.replace(/\\+/g, (m) => {
					return m.length % 2 === 0 ? "\\\\" : m ? "\\" : "";
				});
			}
			if (output === input && opts.contains === true) {
				state.output = input;
				return state;
			}
			state.output = utils.wrapOutput(output, state, options);
			return state;
		}
		/**
		* Tokenize input until we reach end-of-string
		*/
		while (!eos()) {
			value = advance();
			if (value === "\0") continue;
			/**
			* Escaped characters
			*/
			if (value === "\\") {
				const next = peek();
				if (next === "/" && opts.bash !== true) continue;
				if (next === "." || next === ";") continue;
				if (!next) {
					value += "\\";
					push({
						type: "text",
						value
					});
					continue;
				}
				const match = /^\\+/.exec(remaining());
				let slashes = 0;
				if (match && match[0].length > 2) {
					slashes = match[0].length;
					state.index += slashes;
					if (slashes % 2 !== 0) value += "\\";
				}
				if (opts.unescape === true) value = advance();
				else value += advance();
				if (state.brackets === 0) {
					push({
						type: "text",
						value
					});
					continue;
				}
			}
			/**
			* If we're inside a regex character class, continue
			* until we reach the closing bracket.
			*/
			if (state.brackets > 0 && (value !== "]" || prev.value === "[" || prev.value === "[^")) {
				if (opts.posix !== false && value === ":") {
					const inner = prev.value.slice(1);
					if (inner.includes("[")) {
						prev.posix = true;
						if (inner.includes(":")) {
							const idx = prev.value.lastIndexOf("[");
							const pre = prev.value.slice(0, idx);
							const posix = POSIX_REGEX_SOURCE[prev.value.slice(idx + 2)];
							if (posix) {
								prev.value = pre + posix;
								state.backtrack = true;
								advance();
								if (!bos.output && tokens.indexOf(prev) === 1) bos.output = ONE_CHAR;
								continue;
							}
						}
					}
				}
				if (value === "[" && peek() !== ":" || value === "-" && peek() === "]") value = `\\${value}`;
				if (value === "]" && (prev.value === "[" || prev.value === "[^")) value = `\\${value}`;
				if (opts.posix === true && value === "!" && prev.value === "[") value = "^";
				prev.value += value;
				append({ value });
				continue;
			}
			/**
			* If we're inside a quoted string, continue
			* until we reach the closing double quote.
			*/
			if (state.quotes === 1 && value !== "\"") {
				value = utils.escapeRegex(value);
				prev.value += value;
				append({ value });
				continue;
			}
			/**
			* Double quotes
			*/
			if (value === "\"") {
				state.quotes = state.quotes === 1 ? 0 : 1;
				if (opts.keepQuotes === true) push({
					type: "text",
					value
				});
				continue;
			}
			/**
			* Parentheses
			*/
			if (value === "(") {
				increment("parens");
				push({
					type: "paren",
					value
				});
				continue;
			}
			if (value === ")") {
				if (state.parens === 0 && opts.strictBrackets === true) throw new SyntaxError(syntaxError("opening", "("));
				const extglob = extglobs[extglobs.length - 1];
				if (extglob && state.parens === extglob.parens + 1) {
					extglobClose(extglobs.pop());
					continue;
				}
				push({
					type: "paren",
					value,
					output: state.parens ? ")" : "\\)"
				});
				decrement("parens");
				continue;
			}
			/**
			* Square brackets
			*/
			if (value === "[") {
				if (opts.nobracket === true || !remaining().includes("]")) {
					if (opts.nobracket !== true && opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", "]"));
					value = `\\${value}`;
				} else increment("brackets");
				push({
					type: "bracket",
					value
				});
				continue;
			}
			if (value === "]") {
				if (opts.nobracket === true || prev && prev.type === "bracket" && prev.value.length === 1) {
					push({
						type: "text",
						value,
						output: `\\${value}`
					});
					continue;
				}
				if (state.brackets === 0) {
					if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("opening", "["));
					push({
						type: "text",
						value,
						output: `\\${value}`
					});
					continue;
				}
				decrement("brackets");
				const prevValue = prev.value.slice(1);
				if (prev.posix !== true && prevValue[0] === "^" && !prevValue.includes("/")) value = `/${value}`;
				prev.value += value;
				append({ value });
				if (opts.literalBrackets === false || utils.hasRegexChars(prevValue)) continue;
				const escaped = utils.escapeRegex(prev.value);
				state.output = state.output.slice(0, -prev.value.length);
				if (opts.literalBrackets === true) {
					state.output += escaped;
					prev.value = escaped;
					continue;
				}
				prev.value = `(${capture}${escaped}|${prev.value})`;
				state.output += prev.value;
				continue;
			}
			/**
			* Braces
			*/
			if (value === "{" && opts.nobrace !== true) {
				increment("braces");
				const open = {
					type: "brace",
					value,
					output: "(",
					outputIndex: state.output.length,
					tokensIndex: state.tokens.length
				};
				braces.push(open);
				push(open);
				continue;
			}
			if (value === "}") {
				const brace = braces[braces.length - 1];
				if (opts.nobrace === true || !brace) {
					push({
						type: "text",
						value,
						output: value
					});
					continue;
				}
				let output = ")";
				if (brace.dots === true) {
					const arr = tokens.slice();
					const range = [];
					for (let i = arr.length - 1; i >= 0; i--) {
						tokens.pop();
						if (arr[i].type === "brace") break;
						if (arr[i].type !== "dots") range.unshift(arr[i].value);
					}
					output = expandRange(range, opts);
					state.backtrack = true;
				}
				if (brace.comma !== true && brace.dots !== true) {
					const out = state.output.slice(0, brace.outputIndex);
					const toks = state.tokens.slice(brace.tokensIndex);
					brace.value = brace.output = "\\{";
					value = output = "\\}";
					state.output = out;
					for (const t of toks) state.output += t.output || t.value;
				}
				push({
					type: "brace",
					value,
					output
				});
				decrement("braces");
				braces.pop();
				continue;
			}
			/**
			* Pipes
			*/
			if (value === "|") {
				if (extglobs.length > 0) extglobs[extglobs.length - 1].conditions++;
				push({
					type: "text",
					value
				});
				continue;
			}
			/**
			* Commas
			*/
			if (value === ",") {
				let output = value;
				const brace = braces[braces.length - 1];
				if (brace && stack[stack.length - 1] === "braces") {
					brace.comma = true;
					output = "|";
				}
				push({
					type: "comma",
					value,
					output
				});
				continue;
			}
			/**
			* Slashes
			*/
			if (value === "/") {
				if (prev.type === "dot" && state.index === state.start + 1) {
					state.start = state.index + 1;
					state.consumed = "";
					state.output = "";
					tokens.pop();
					prev = bos;
					continue;
				}
				push({
					type: "slash",
					value,
					output: SLASH_LITERAL
				});
				continue;
			}
			/**
			* Dots
			*/
			if (value === ".") {
				if (state.braces > 0 && prev.type === "dot") {
					if (prev.value === ".") prev.output = DOT_LITERAL;
					const brace = braces[braces.length - 1];
					prev.type = "dots";
					prev.output += value;
					prev.value += value;
					brace.dots = true;
					continue;
				}
				if (state.braces + state.parens === 0 && prev.type !== "bos" && prev.type !== "slash") {
					push({
						type: "text",
						value,
						output: DOT_LITERAL
					});
					continue;
				}
				push({
					type: "dot",
					value,
					output: DOT_LITERAL
				});
				continue;
			}
			/**
			* Question marks
			*/
			if (value === "?") {
				if (!(prev && prev.value === "(") && opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
					extglobOpen("qmark", value);
					continue;
				}
				if (prev && prev.type === "paren") {
					const next = peek();
					let output = value;
					if (prev.value === "(" && !/[!=<:]/.test(next) || next === "<" && !/<([!=]|\w+>)/.test(remaining())) output = `\\${value}`;
					push({
						type: "text",
						value,
						output
					});
					continue;
				}
				if (opts.dot !== true && (prev.type === "slash" || prev.type === "bos")) {
					push({
						type: "qmark",
						value,
						output: QMARK_NO_DOT
					});
					continue;
				}
				push({
					type: "qmark",
					value,
					output: QMARK
				});
				continue;
			}
			/**
			* Exclamation
			*/
			if (value === "!") {
				if (opts.noextglob !== true && peek() === "(") {
					if (peek(2) !== "?" || !/[!=<:]/.test(peek(3))) {
						extglobOpen("negate", value);
						continue;
					}
				}
				if (opts.nonegate !== true && state.index === 0) {
					negate();
					continue;
				}
			}
			/**
			* Plus
			*/
			if (value === "+") {
				if (opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
					extglobOpen("plus", value);
					continue;
				}
				if (prev && prev.value === "(" || opts.regex === false) {
					push({
						type: "plus",
						value,
						output: PLUS_LITERAL
					});
					continue;
				}
				if (prev && (prev.type === "bracket" || prev.type === "paren" || prev.type === "brace") || state.parens > 0) {
					push({
						type: "plus",
						value
					});
					continue;
				}
				push({
					type: "plus",
					value: PLUS_LITERAL
				});
				continue;
			}
			/**
			* Plain text
			*/
			if (value === "@") {
				if (opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
					push({
						type: "at",
						extglob: true,
						value,
						output: ""
					});
					continue;
				}
				push({
					type: "text",
					value
				});
				continue;
			}
			/**
			* Plain text
			*/
			if (value !== "*") {
				if (value === "$" || value === "^") value = `\\${value}`;
				const match = REGEX_NON_SPECIAL_CHARS.exec(remaining());
				if (match) {
					value += match[0];
					state.index += match[0].length;
				}
				push({
					type: "text",
					value
				});
				continue;
			}
			/**
			* Stars
			*/
			if (prev && (prev.type === "globstar" || prev.star === true)) {
				prev.type = "star";
				prev.star = true;
				prev.value += value;
				prev.output = star;
				state.backtrack = true;
				state.globstar = true;
				consume(value);
				continue;
			}
			let rest = remaining();
			if (opts.noextglob !== true && /^\([^?]/.test(rest)) {
				extglobOpen("star", value);
				continue;
			}
			if (prev.type === "star") {
				if (opts.noglobstar === true) {
					consume(value);
					continue;
				}
				const prior = prev.prev;
				const before = prior.prev;
				const isStart = prior.type === "slash" || prior.type === "bos";
				const afterStar = before && (before.type === "star" || before.type === "globstar");
				if (opts.bash === true && (!isStart || rest[0] && rest[0] !== "/")) {
					push({
						type: "star",
						value,
						output: ""
					});
					continue;
				}
				const isBrace = state.braces > 0 && (prior.type === "comma" || prior.type === "brace");
				const isExtglob = extglobs.length && (prior.type === "pipe" || prior.type === "paren");
				if (!isStart && prior.type !== "paren" && !isBrace && !isExtglob) {
					push({
						type: "star",
						value,
						output: ""
					});
					continue;
				}
				while (rest.slice(0, 3) === "/**") {
					const after = input[state.index + 4];
					if (after && after !== "/") break;
					rest = rest.slice(3);
					consume("/**", 3);
				}
				const isEnd = eos() || state.parens > 0 && rest === ")".repeat(state.parens) && !extglobs.some((extglob) => extglob.type === "negate");
				if (prior.type === "bos" && eos()) {
					prev.type = "globstar";
					prev.value += value;
					prev.output = globstar(opts);
					state.output = prev.output;
					state.globstar = true;
					consume(value);
					continue;
				}
				if (prior.type === "slash" && prior.prev.type !== "bos" && !afterStar && isEnd) {
					state.output = state.output.slice(0, -(prior.output + prev.output).length);
					prior.output = `(?:${prior.output}`;
					prev.type = "globstar";
					prev.output = globstar(opts) + (opts.strictSlashes ? ")" : "|$)");
					prev.value += value;
					state.globstar = true;
					state.output += prior.output + prev.output;
					consume(value);
					continue;
				}
				if (prior.type === "slash" && prior.prev.type !== "bos" && rest[0] === "/") {
					const end = rest[1] !== void 0 ? "|$" : "";
					state.output = state.output.slice(0, -(prior.output + prev.output).length);
					prior.output = `(?:${prior.output}`;
					prev.type = "globstar";
					prev.output = `${globstar(opts)}${SLASH_LITERAL}|${SLASH_LITERAL}${end})`;
					prev.value += value;
					state.output += prior.output + prev.output;
					state.globstar = true;
					consume(value + advance());
					push({
						type: "slash",
						value: "/",
						output: ""
					});
					continue;
				}
				if (prior.type === "bos" && rest[0] === "/") {
					prev.type = "globstar";
					prev.value += value;
					prev.output = `(?:^|${SLASH_LITERAL}|${globstar(opts)}${SLASH_LITERAL})`;
					state.output = prev.output;
					state.globstar = true;
					consume(value + advance());
					push({
						type: "slash",
						value: "/",
						output: ""
					});
					continue;
				}
				state.output = state.output.slice(0, -prev.output.length);
				prev.type = "globstar";
				prev.output = globstar(opts);
				prev.value += value;
				state.output += prev.output;
				state.globstar = true;
				consume(value);
				continue;
			}
			const token = {
				type: "star",
				value,
				output: star
			};
			if (opts.bash === true) {
				token.output = ".*?";
				if (prev.type === "bos" || prev.type === "slash") token.output = nodot + token.output;
				push(token);
				continue;
			}
			if (prev && (prev.type === "bracket" || prev.type === "paren") && opts.regex === true) {
				token.output = value;
				push(token);
				continue;
			}
			if (state.index === state.start || prev.type === "slash" || prev.type === "dot") {
				if (prev.type === "dot") {
					state.output += NO_DOT_SLASH;
					prev.output += NO_DOT_SLASH;
				} else if (opts.dot === true) {
					state.output += NO_DOTS_SLASH;
					prev.output += NO_DOTS_SLASH;
				} else {
					state.output += nodot;
					prev.output += nodot;
				}
				if (peek() !== "*") {
					state.output += ONE_CHAR;
					prev.output += ONE_CHAR;
				}
			}
			push(token);
		}
		while (state.brackets > 0) {
			if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", "]"));
			state.output = utils.escapeLast(state.output, "[");
			decrement("brackets");
		}
		while (state.parens > 0) {
			if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", ")"));
			state.output = utils.escapeLast(state.output, "(");
			decrement("parens");
		}
		while (state.braces > 0) {
			if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", "}"));
			state.output = utils.escapeLast(state.output, "{");
			decrement("braces");
		}
		if (opts.strictSlashes !== true && (prev.type === "star" || prev.type === "bracket")) push({
			type: "maybe_slash",
			value: "",
			output: `${SLASH_LITERAL}?`
		});
		if (state.backtrack === true) {
			state.output = "";
			for (const token of state.tokens) {
				state.output += token.output != null ? token.output : token.value;
				if (token.suffix) state.output += token.suffix;
			}
		}
		return state;
	};
	/**
	* Fast paths for creating regular expressions for common glob patterns.
	* This can significantly speed up processing and has very little downside
	* impact when none of the fast paths match.
	*/
	parse.fastpaths = (input, options) => {
		const opts = { ...options };
		const max = typeof opts.maxLength === "number" ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
		const len = input.length;
		if (len > max) throw new SyntaxError(`Input length: ${len}, exceeds maximum allowed length: ${max}`);
		input = REPLACEMENTS[input] || input;
		const { DOT_LITERAL, SLASH_LITERAL, ONE_CHAR, DOTS_SLASH, NO_DOT, NO_DOTS, NO_DOTS_SLASH, STAR, START_ANCHOR } = constants.globChars(opts.windows);
		const nodot = opts.dot ? NO_DOTS : NO_DOT;
		const slashDot = opts.dot ? NO_DOTS_SLASH : NO_DOT;
		const capture = opts.capture ? "" : "?:";
		const state = {
			negated: false,
			prefix: ""
		};
		let star = opts.bash === true ? ".*?" : STAR;
		if (opts.capture) star = `(${star})`;
		const globstar = (opts) => {
			if (opts.noglobstar === true) return star;
			return `(${capture}(?:(?!${START_ANCHOR}${opts.dot ? DOTS_SLASH : DOT_LITERAL}).)*?)`;
		};
		const create = (str) => {
			switch (str) {
				case "*": return `${nodot}${ONE_CHAR}${star}`;
				case ".*": return `${DOT_LITERAL}${ONE_CHAR}${star}`;
				case "*.*": return `${nodot}${star}${DOT_LITERAL}${ONE_CHAR}${star}`;
				case "*/*": return `${nodot}${star}${SLASH_LITERAL}${ONE_CHAR}${slashDot}${star}`;
				case "**": return nodot + globstar(opts);
				case "**/*": return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${slashDot}${ONE_CHAR}${star}`;
				case "**/*.*": return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${slashDot}${star}${DOT_LITERAL}${ONE_CHAR}${star}`;
				case "**/.*": return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${DOT_LITERAL}${ONE_CHAR}${star}`;
				default: {
					const match = /^(.*?)\.(\w+)$/.exec(str);
					if (!match) return;
					const source = create(match[1]);
					if (!source) return;
					return source + DOT_LITERAL + match[2];
				}
			}
		};
		let source = create(utils.removePrefix(input, state));
		if (source && opts.strictSlashes !== true) source += `${SLASH_LITERAL}?`;
		return source;
	};
	module.exports = parse;
}));
// node_modules/picomatch/lib/picomatch.js
var require_picomatch$1 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var scan = require_scan();
	var parse = require_parse();
	var utils = require_utils();
	var constants = require_constants();
	var isObject = (val) => val && typeof val === "object" && !Array.isArray(val);
	/**
	* Creates a matcher function from one or more glob patterns. The
	* returned function takes a string to match as its first argument,
	* and returns true if the string is a match. The returned matcher
	* function also takes a boolean as the second argument that, when true,
	* returns an object with additional information.
	*
	* ```js
	* const picomatch = require('picomatch');
	* // picomatch(glob[, options]);
	*
	* const isMatch = picomatch('*.!(*a)');
	* console.log(isMatch('a.a')); //=> false
	* console.log(isMatch('a.b')); //=> true
	*
	* // For environments without `node.js`, `picomatch/posix` provides you a dependency-free matcher, without automatic OS detection.
	* const picomatch = require('picomatch/posix');
	* // the same API, defaulting to posix paths
	* const isMatch = picomatch('a/*');
	* console.log(isMatch('a\\b')); //=> false
	* console.log(isMatch('a/b')); //=> true
	*
	* // you can still configure the matcher function to accept windows paths
	* const isMatch = picomatch('a/*', { options: windows });
	* console.log(isMatch('a\\b')); //=> true
	* console.log(isMatch('a/b')); //=> true
	* ```
	* @name picomatch
	* @param {String|Array} `globs` One or more glob patterns.
	* @param {Object=} `options`
	* @return {Function=} Returns a matcher function.
	* @api public
	*/
	var picomatch = (glob, options, returnState = false) => {
		if (Array.isArray(glob)) {
			const fns = glob.map((input) => picomatch(input, options, returnState));
			const arrayMatcher = (str) => {
				for (const isMatch of fns) {
					const state = isMatch(str);
					if (state) return state;
				}
				return false;
			};
			return arrayMatcher;
		}
		const isState = isObject(glob) && glob.tokens && glob.input;
		if (glob === "" || typeof glob !== "string" && !isState) throw new TypeError("Expected pattern to be a non-empty string");
		const opts = options || {};
		const posix = opts.windows;
		const regex = isState ? picomatch.compileRe(glob, options) : picomatch.makeRe(glob, options, false, true);
		const state = regex.state;
		delete regex.state;
		let isIgnored = () => false;
		if (opts.ignore) {
			const ignoreOpts = {
				...options,
				ignore: null,
				onMatch: null,
				onResult: null
			};
			isIgnored = picomatch(opts.ignore, ignoreOpts, returnState);
		}
		const matcher = (input, returnObject = false) => {
			const { isMatch, match, output } = picomatch.test(input, regex, options, {
				glob,
				posix
			});
			const result = {
				glob,
				state,
				regex,
				posix,
				input,
				output,
				match,
				isMatch
			};
			if (typeof opts.onResult === "function") opts.onResult(result);
			if (isMatch === false) {
				result.isMatch = false;
				return returnObject ? result : false;
			}
			if (isIgnored(input)) {
				if (typeof opts.onIgnore === "function") opts.onIgnore(result);
				result.isMatch = false;
				return returnObject ? result : false;
			}
			if (typeof opts.onMatch === "function") opts.onMatch(result);
			return returnObject ? result : true;
		};
		if (returnState) matcher.state = state;
		return matcher;
	};
	/**
	* Test `input` with the given `regex`. This is used by the main
	* `picomatch()` function to test the input string.
	*
	* ```js
	* const picomatch = require('picomatch');
	* // picomatch.test(input, regex[, options]);
	*
	* console.log(picomatch.test('foo/bar', /^(?:([^/]*?)\/([^/]*?))$/));
	* // { isMatch: true, match: [ 'foo/', 'foo', 'bar' ], output: 'foo/bar' }
	* ```
	* @param {String} `input` String to test.
	* @param {RegExp} `regex`
	* @return {Object} Returns an object with matching info.
	* @api public
	*/
	picomatch.test = (input, regex, options, { glob, posix } = {}) => {
		if (typeof input !== "string") throw new TypeError("Expected input to be a string");
		if (input === "") return {
			isMatch: false,
			output: ""
		};
		const opts = options || {};
		const format = opts.format || (posix ? utils.toPosixSlashes : null);
		let match = input === glob;
		let output = match && format ? format(input) : input;
		if (match === false) {
			output = format ? format(input) : input;
			match = output === glob;
		}
		if (match === false || opts.capture === true) {
			if (opts.matchBase === true || opts.basename === true) match = picomatch.matchBase(input, regex, options, posix);
			else match = regex.exec(output);
		}
		return {
			isMatch: Boolean(match),
			match,
			output
		};
	};
	/**
	* Match the basename of a filepath.
	*
	* ```js
	* const picomatch = require('picomatch');
	* // picomatch.matchBase(input, glob[, options]);
	* console.log(picomatch.matchBase('foo/bar.js', '*.js'); // true
	* ```
	* @param {String} `input` String to test.
	* @param {RegExp|String} `glob` Glob pattern or regex created by [.makeRe](#makeRe).
	* @return {Boolean}
	* @api public
	*/
	picomatch.matchBase = (input, glob, options, posix = options && options.windows) => {
		return (glob instanceof RegExp ? glob : picomatch.makeRe(glob, options)).test(utils.basename(input, { windows: posix }));
	};
	/**
	* Returns true if **any** of the given glob `patterns` match the specified `string`.
	*
	* ```js
	* const picomatch = require('picomatch');
	* // picomatch.isMatch(string, patterns[, options]);
	*
	* console.log(picomatch.isMatch('a.a', ['b.*', '*.a'])); //=> true
	* console.log(picomatch.isMatch('a.a', 'b.*')); //=> false
	* ```
	* @param {String|Array} str The string to test.
	* @param {String|Array} patterns One or more glob patterns to use for matching.
	* @param {Object} [options] See available [options](#options).
	* @return {Boolean} Returns true if any patterns match `str`
	* @api public
	*/
	picomatch.isMatch = (str, patterns, options) => picomatch(patterns, options)(str);
	/**
	* Parse a glob pattern to create the source string for a regular
	* expression.
	*
	* ```js
	* const picomatch = require('picomatch');
	* const result = picomatch.parse(pattern[, options]);
	* ```
	* @param {String} `pattern`
	* @param {Object} `options`
	* @return {Object} Returns an object with useful properties and output to be used as a regex source string.
	* @api public
	*/
	picomatch.parse = (pattern, options) => {
		if (Array.isArray(pattern)) return pattern.map((p) => picomatch.parse(p, options));
		return parse(pattern, {
			...options,
			fastpaths: false
		});
	};
	/**
	* Scan a glob pattern to separate the pattern into segments.
	*
	* ```js
	* const picomatch = require('picomatch');
	* // picomatch.scan(input[, options]);
	*
	* const result = picomatch.scan('!./foo/*.js');
	* console.log(result);
	* { prefix: '!./',
	*   input: '!./foo/*.js',
	*   start: 3,
	*   base: 'foo',
	*   glob: '*.js',
	*   isBrace: false,
	*   isBracket: false,
	*   isGlob: true,
	*   isExtglob: false,
	*   isGlobstar: false,
	*   negated: true }
	* ```
	* @param {String} `input` Glob pattern to scan.
	* @param {Object} `options`
	* @return {Object} Returns an object with
	* @api public
	*/
	picomatch.scan = (input, options) => scan(input, options);
	/**
	* Compile a regular expression from the `state` object returned by the
	* [parse()](#parse) method.
	*
	* ```js
	* const picomatch = require('picomatch');
	* const state = picomatch.parse('*.js');
	* // picomatch.compileRe(state[, options]);
	*
	* console.log(picomatch.compileRe(state));
	* //=> /^(?:(?!\.)(?=.)[^/]*?\.js)$/
	* ```
	* @param {Object} `state`
	* @param {Object} `options`
	* @param {Boolean} `returnOutput` Intended for implementors, this argument allows you to return the raw output from the parser.
	* @param {Boolean} `returnState` Adds the state to a `state` property on the returned regex. Useful for implementors and debugging.
	* @return {RegExp}
	* @api public
	*/
	picomatch.compileRe = (state, options, returnOutput = false, returnState = false) => {
		if (returnOutput === true) return state.output;
		const opts = options || {};
		const prepend = opts.contains ? "" : "^";
		const append = opts.contains ? "" : "$";
		let source = `${prepend}(?:${state.output})${append}`;
		if (state && state.negated === true) source = `^(?!${source}).*$`;
		const regex = picomatch.toRegex(source, options);
		if (returnState === true) regex.state = state;
		return regex;
	};
	/**
	* Create a regular expression from a parsed glob pattern.
	*
	* ```js
	* const picomatch = require('picomatch');
	* // picomatch.makeRe(state[, options]);
	*
	* const result = picomatch.makeRe('*.js');
	* console.log(result);
	* //=> /^(?:(?!\.)(?=.)[^/]*?\.js)$/
	* ```
	* @param {String} `state` The object returned from the `.parse` method.
	* @param {Object} `options`
	* @param {Boolean} `returnOutput` Implementors may use this argument to return the compiled output, instead of a regular expression. This is not exposed on the options to prevent end-users from mutating the result.
	* @param {Boolean} `returnState` Implementors may use this argument to return the state from the parsed glob with the returned regular expression.
	* @return {RegExp} Returns a regex created from the given pattern.
	* @api public
	*/
	picomatch.makeRe = (input, options = {}, returnOutput = false, returnState = false) => {
		if (!input || typeof input !== "string") throw new TypeError("Expected a non-empty string");
		let parsed = {
			negated: false,
			fastpaths: true
		};
		if (options.fastpaths !== false && (input[0] === "." || input[0] === "*")) parsed.output = parse.fastpaths(input, options);
		if (!parsed.output) parsed = parse(input, options);
		return picomatch.compileRe(parsed, options, returnOutput, returnState);
	};
	/**
	* Create a regular expression from the given regex source string.
	*
	* ```js
	* const picomatch = require('picomatch');
	* // picomatch.toRegex(source[, options]);
	*
	* const { output } = picomatch.parse('*.js');
	* console.log(picomatch.toRegex(output));
	* //=> /^(?:(?!\.)(?=.)[^/]*?\.js)$/
	* ```
	* @param {String} `source` Regular expression source string.
	* @param {Object} `options`
	* @return {RegExp}
	* @api public
	*/
	picomatch.toRegex = (source, options) => {
		try {
			const opts = options || {};
			return new RegExp(source, opts.flags || (opts.nocase ? "i" : ""));
		} catch (err) {
			if (options && options.debug === true) throw err;
			return /$^/;
		}
	};
	/**
	* Picomatch constants.
	* @return {Object}
	*/
	picomatch.constants = constants;
	/**
	* Expose "picomatch"
	*/
	module.exports = picomatch;
}));
// src/rules/matcher.ts
var import_picomatch = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports, module) => {
	var pico = require_picomatch$1();
	var utils = require_utils();
	function picomatch(glob, options, returnState = false) {
		if (options && (options.windows === null || options.windows === void 0)) options = {
			...options,
			windows: utils.isWindows()
		};
		return pico(glob, options, returnState);
	}
	Object.assign(picomatch, pico);
	module.exports = picomatch;
})))(), 1);
var RuleMatcher = class {
	match(rule, targetKey, sessionRoot, isInside) {
		if (!isInside && !rule.isGlobal) return { diagnostics: [] };
		if (rule.metadata.alwaysApply) return {
			reason: "alwaysApply",
			diagnostics: []
		};
		const basename = posix.basename(targetKey);
		const bases = isInside ? [.../* @__PURE__ */ new Set([posix.relative(sessionRoot, targetKey), basename])] : [basename];
		const positives = [];
		const negatives = [];
		const diagnostics = [];
		for (const pattern of rule.metadata.globs) {
			const negative = pattern.startsWith("!") && !pattern.startsWith("!(");
			try {
				const test = (0, import_picomatch.default)(negative ? pattern.slice(1) : pattern, {
					bash: false,
					dot: true,
					nonegate: true,
					nocase: false,
					strictBrackets: true,
					debug: true,
					windows: false
				});
				if (negative) negatives.push(test);
				else positives.push({
					pattern,
					test
				});
			} catch (error) {
				diagnostics.push({
					severity: "warning",
					code: "invalid-glob",
					source: rule.discoveredPath,
					message: `Invalid glob ${JSON.stringify(pattern)}: ${error instanceof Error ? error.message : String(error)}`
				});
			}
		}
		let result = { diagnostics };
		if (diagnostics.length === 0) {
			const positive = positives.find(({ test }) => bases.some((basis) => test(basis)));
			if (positive && !negatives.some((test) => bases.some((basis) => test(basis)))) result = {
				reason: positive.pattern,
				diagnostics
			};
		}
		return result;
	}
};
// src/rules/engine.ts
var RulesEngine = class {
	environment;
	matcher = new RuleMatcher();
	active = /* @__PURE__ */ new Map();
	native = /* @__PURE__ */ new Set();
	general = [];
	observations = [];
	injected = /* @__PURE__ */ new Set();
	domains = {};
	lastTargets = [];
	lastTargetCwd = "";
	discoveryOptions;
	lastStats;
	config;
	identity = 0;
	options;
	constructor(options = {}) {
		this.options = options;
		this.environment = { ...options.env ?? process.env };
		const parsed = readConfiguration(this.environment, {});
		this.config = parsed.config;
		this.domains.configuration = parsed.diagnostics;
	}
	get sessionIdentity() {
		return this.identity;
	}
	get snapshot() {
		const diagnostics = Object.fromEntries(Object.entries(this.domains).map(([key, items]) => [key, [...items]]));
		return {
			sessionRoot: this.discoveryOptions?.sessionRoot ?? "",
			config: { ...this.config },
			known: [...this.observations],
			activated: [...this.active.values()],
			injected: new Set(this.injected),
			diagnostics,
			warnings: uniqueDiagnostics(Object.values(diagnostics).flat()),
			stats: this.lastStats && { ...this.lastStats }
		};
	}
	syncFlags(flags) {
		const parsed = readConfiguration(this.environment, flags);
		this.config = parsed.config;
		this.domains.configuration = parsed.diagnostics;
	}
	startSession(cwd) {
		this.identity++;
		this.active.clear();
		this.general = [];
		this.observations = [];
		this.injected.clear();
		this.native.clear();
		this.lastTargets = [];
		this.lastTargetCwd = "";
		this.lastStats = void 0;
		this.domains = { configuration: this.domains.configuration ?? [] };
		this.discoveryOptions = void 0;
		try {
			this.discoveryOptions = {
				sessionRoot: physicalPath(cwd, cwd, this.options.fs),
				homeDir: physicalPath(this.options.homeDir ?? homedir(), cwd, this.options.fs),
				allowlist: this.options.allowlist,
				fs: this.options.fs
			};
		} catch (error) {
			this.domains.loading = [warning("read-failed", cwd, error)];
			return;
		}
		this.refresh();
	}
	prepareAgent(nativePaths) {
		if (!this.discoveryOptions) return;
		this.refresh();
		this.native.clear();
		const errors = [];
		for (const path of nativePaths) try {
			this.native.add(physicalPath(path, this.discoveryOptions.sessionRoot, this.options.fs));
		} catch (error) {
			errors.push(warning("read-failed", path, error));
		}
		this.domains.loading = uniqueDiagnostics([...this.domains.loading ?? [], ...errors]);
	}
	activateTargets(paths, cwd) {
		if (!this.discoveryOptions || this.config.disabled || this.config.mode === "off") return;
		const diagnostics = [];
		let targetCwd;
		try {
			targetCwd = physicalPath(cwd, cwd, this.options.fs);
		} catch (error) {
			this.domains.loading = [warning("read-failed", cwd, error)];
			return;
		}
		const targets = /* @__PURE__ */ new Set();
		for (const path of new Set(paths.map((input) => resolve(targetCwd, input)))) try {
			targets.add(physicalPath(path, cwd, this.options.fs));
		} catch (error) {
			diagnostics.push(warning("read-failed", path, error));
		}
		if (targets.size === 0) {
			this.domains.loading = diagnostics;
			return;
		}
		const batch = discoverRules(this.discoveryOptions, this.knownCandidates());
		this.lastStats = batch.stats;
		diagnostics.push(...this.refreshActive(batch.observations));
		this.general = this.generalRules(batch.observations);
		this.lastTargets = [...targets];
		this.lastTargetCwd = targetCwd;
		this.observations = this.matchObservations(batch.observations, diagnostics);
		const selected = /* @__PURE__ */ new Map();
		for (const observation of this.observations) if (observation.rule && observation.matchReason && !selected.has(observation.realPath)) selected.set(observation.realPath, observation.rule);
		for (const [path, rule] of selected) {
			const previous = this.active.get(path);
			this.active.set(path, previous?.contentHash === rule.contentHash ? previous : rule);
		}
		this.domains.loading = uniqueDiagnostics([...batch.diagnostics, ...diagnostics]);
	}
	formatRequest() {
		if (this.config.disabled || this.config.mode === "off") return {
			text: "",
			included: [],
			omitted: [],
			diagnostics: []
		};
		const groups = [];
		if (this.config.mode !== "dynamic") groups.push(...this.general);
		if (this.config.mode !== "static") groups.push(...this.active.values());
		const seen = new Set(this.native);
		return formatRules(groups.filter((rule) => {
			if (seen.has(rule.realPath)) return false;
			seen.add(rule.realPath);
			return true;
		}), this.config);
	}
	commitInjection(result) {
		this.injected = new Set(result.included.map(({ rule }) => rule.ruleKey));
		this.domains.formatting = uniqueDiagnostics(result.diagnostics);
	}
	inspect() {
		if (!this.discoveryOptions) return this.snapshot;
		const batch = discoverRules(this.discoveryOptions, this.knownCandidates());
		const diagnostics = [...batch.diagnostics];
		this.observations = this.matchObservations(batch.observations, diagnostics);
		this.lastStats = batch.stats;
		this.domains.inspection = uniqueDiagnostics(diagnostics);
		return this.snapshot;
	}
	reload() {
		const previous = new Map([...this.active].map(([path, rule]) => [path, rule.ruleKey]));
		this.refresh();
		this.injected.clear();
		this.domains.formatting = [];
		this.domains.inspection = [];
		let updated = 0;
		let removed = 0;
		for (const [path, key] of previous) {
			const next = this.active.get(path);
			if (!next) removed++;
			else if (next.ruleKey !== key) updated++;
		}
		return {
			updated,
			removed
		};
	}
	setUIDiagnostic(error) {
		this.domains.ui = error === void 0 ? [] : [warning("ui-failed", "pi-rules", error)];
	}
	knownCandidates() {
		const candidates = /* @__PURE__ */ new Map();
		for (const item of [...this.observations, ...this.active.values()]) {
			const key = JSON.stringify([item.source, item.discoveredPath]);
			candidates.set(key, item);
		}
		return [...candidates.values()];
	}
	generalRules(observations) {
		const selected = /* @__PURE__ */ new Map();
		for (const item of [...observations].sort(compareCandidates)) if (item.rule?.metadata.alwaysApply && !selected.has(item.realPath)) {
			const previous = this.general.find((rule) => rule.realPath === item.realPath && rule.discoveredPath === item.discoveredPath && rule.source === item.source);
			selected.set(item.realPath, previous?.contentHash === item.rule.contentHash ? previous : item.rule);
		}
		return [...selected.values()];
	}
	refreshActive(observations) {
		const diagnostics = [];
		for (const [path, previous] of this.active) {
			const found = observations.find((item) => item.discoveredPath === previous.discoveredPath && item.source === previous.source && item.realPath === path);
			if (!found?.rule) {
				this.active.delete(path);
				if (!found) diagnostics.push(warning("read-failed", previous.discoveredPath, "Activated rule is no longer available at its discovered path."));
			} else if (found.rule.contentHash !== previous.contentHash) this.active.set(path, found.rule);
		}
		return diagnostics;
	}
	refresh() {
		if (!this.discoveryOptions) return;
		const batch = discoverRules(this.discoveryOptions, this.knownCandidates());
		this.lastStats = batch.stats;
		const diagnostics = [...batch.diagnostics, ...this.refreshActive(batch.observations)];
		this.general = this.generalRules(batch.observations);
		this.observations = this.matchObservations(batch.observations, diagnostics);
		this.domains.loading = uniqueDiagnostics(diagnostics);
	}
	matchObservations(observations, diagnostics) {
		const insideTargets = new Map(this.lastTargets.map((target) => [target, this.discoveryOptions ? isWithin(this.discoveryOptions.sessionRoot, target) : false]));
		return [...observations].sort(compareCandidates).map((item) => {
			const observation = {
				...item,
				matchReason: void 0,
				targets: []
			};
			if (!item.rule || !this.discoveryOptions) return observation;
			for (const target of this.lastTargets) {
				const inside = insideTargets.get(target) ?? false;
				if (!inside && !item.isGlobal) continue;
				const result = this.matcher.match(item.rule, slash(target), this.discoveryOptions.sessionRoot, inside);
				diagnostics.push(...result.diagnostics);
				if (result.reason) {
					observation.matchReason ??= result.reason;
					observation.targets?.push(slash(relative(this.lastTargetCwd, target)));
				}
			}
			return observation;
		});
	}
};
// src/system-context.ts
/** Replace only this extension's request-local section, preserving transcript deltas. */
function replaceRulesSection(messages, text) {
	const result = messages.map((message, index) => {
		if (message.role !== "system") return message;
		const sections = { ...message.sections };
		delete sections.pi_rules;
		if (index === 0 && text !== "") sections.pi_rules = text;
		const copy = { ...message };
		if (message.sections !== void 0 || Object.keys(sections).length > 0) copy.sections = sections;
		return copy;
	});
	if (messages[0]?.role !== "system" && text !== "") result.unshift({
		role: "system",
		content: "",
		sections: { pi_rules: text },
		timestamp: messages[0]?.timestamp ?? Date.now()
	});
	return result;
}
// src/ui.ts
var widgetKey = "pi-rules:banner";
var statusKey = "pi-rules";
var RulesUI = class {
	banner = true;
	installed = false;
	stderr;
	constructor(stderr = (text) => {
		process.stderr.write(text);
	}) {
		this.stderr = stderr;
	}
	start() {
		this.banner = true;
	}
	collapse() {
		this.banner = false;
	}
	output(ctx, text) {
		if ((ctx.mode === "tui" || ctx.mode === "rpc") && ctx.hasUI) ctx.ui.notify(text, "info");
		else this.stderr(`${text}\n`);
	}
	update(ctx, snapshot) {
		if (ctx.mode !== "tui" || !ctx.hasUI || !snapshot.config.widget) {
			this.clear(ctx);
			return;
		}
		this.installed = true;
		const stopped = snapshot.config.disabled || snapshot.config.mode === "off" ? " [injection stopped]" : "";
		ctx.ui.setStatus(statusKey, `${rulesSummary(snapshot)}${stopped}`);
		if (!this.banner) {
			ctx.ui.setWidget(widgetKey, void 0);
			return;
		}
		const seen = /* @__PURE__ */ new Set();
		const known = snapshot.known.filter((item) => {
			if (seen.has(item.realPath)) return false;
			seen.add(item.realPath);
			return true;
		});
		const paths = known.slice(0, 5).map((item) => item.relativePath);
		const lines = [`[pi-rules] ${known.length} known · ${snapshot.warnings.length} warnings`, ...paths];
		ctx.ui.setWidget(widgetKey, () => ({
			render: (width) => lines.map((line) => {
				const themed = ctx.ui.theme.fg("muted", line);
				return visibleWidth(themed) <= width ? themed : truncateToWidth(themed, Math.max(0, width));
			}),
			invalidate: () => {}
		}));
	}
	clear(ctx) {
		if (!this.installed) return;
		ctx.ui.setWidget(widgetKey, void 0);
		ctx.ui.setStatus(statusKey, void 0);
		this.installed = false;
	}
};
// src/index.ts
function toolTargets(event) {
	if (event.parentToolCallId !== void 0 || event.toolName !== "edit" && event.toolName !== "write") return [];
	const input = event.input;
	if (input === null || typeof input !== "object" || Array.isArray(input)) return [];
	const record = input;
	return (event.toolName === "write" ? [record.filePath, record.path] : [record.path]).filter((path) => typeof path === "string" && path.trim().length > 0);
}
/** Injectable filesystem, home, environment and output boundaries for embedding and tests. */
function registerRules(pi, options = {}) {
	const engine = new RulesEngine(options);
	const ui = new RulesUI(options.stderr);
	let generation = 0;
	const sync = (ctx) => {
		engine.syncFlags({
			disabled: pi.getFlag("pi-rules-disabled"),
			mode: pi.getFlag("pi-rules-mode"),
			widget: pi.getFlag("pi-rules-widget")
		});
		if (!engine.snapshot.sessionRoot) engine.startSession(ctx.cwd);
	};
	const update = (ctx) => {
		try {
			engine.setUIDiagnostic();
			ui.update(ctx, engine.snapshot);
		} catch (error) {
			engine.setUIDiagnostic(error);
		}
	};
	const output = (ctx, text) => {
		try {
			ui.output(ctx, text);
		} catch (error) {
			engine.setUIDiagnostic(error);
			(options.stderr ?? ((value) => {
				process.stderr.write(value);
			}))(`${text}\n`);
		}
	};
	pi.registerFlag("pi-rules-disabled", {
		type: "boolean",
		default: false,
		description: "Pause rule activation and injection"
	});
	pi.registerFlag("pi-rules-mode", {
		type: "string",
		default: "both",
		description: "Rule mode: static, dynamic, both or off"
	});
	pi.registerFlag("pi-rules-widget", {
		type: "string",
		default: "true",
		description: "Display rule widgets: true or false"
	});
	pi.on("session_start", (_event, ctx) => {
		generation++;
		engine.startSession(ctx.cwd);
		sync(ctx);
		ui.start();
		update(ctx);
	});
	pi.on("before_agent_start", (event, ctx) => {
		sync(ctx);
		engine.prepareAgent(event.systemPromptOptions.contextFiles.map((file) => file.path));
		update(ctx);
	});
	pi.on("tool_call", (event, ctx) => {
		sync(ctx);
		const paths = toolTargets(event);
		if (paths.length) engine.activateTargets(paths, ctx.cwd);
		update(ctx);
	});
	pi.on("context_with_system", (event, ctx) => {
		sync(ctx);
		const result = engine.formatRequest();
		const messages = replaceRulesSection(event.messages, result.text);
		engine.commitInjection(result);
		ui.collapse();
		update(ctx);
		return { messages };
	});
	pi.on("session_shutdown", (_event, ctx) => {
		generation++;
		try {
			ui.clear(ctx);
		} catch (error) {
			engine.setUIDiagnostic(error);
		}
	});
	pi.registerCommand("rules", {
		description: "Inspect rules: list, show <id>, paths, status",
		getArgumentCompletions: ruleCompletions,
		handler: async (args, ctx) => {
			sync(ctx);
			const text = rulesCommand(args, engine.inspect());
			update(ctx);
			output(ctx, text);
		}
	});
	pi.registerCommand("reload-rules", {
		description: "Wait until idle and reload rules without resetting activation order",
		handler: async (_args, ctx) => {
			sync(ctx);
			const identity = engine.sessionIdentity;
			const token = generation;
			await ctx.waitForIdle();
			if (identity !== engine.sessionIdentity || token !== generation) return;
			sync(ctx);
			const changed = engine.reload();
			update(ctx);
			output(ctx, `[pi-rules] Reloaded: updated=${changed.updated} removed=${changed.removed}\n${rulesSummary(engine.snapshot)}`);
		}
	});
	return engine;
}
function extension(pi) {
	registerRules(pi);
}
export { extension as default, registerRules, toolTargets };

//# sourceMappingURL=index.js.map