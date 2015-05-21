/*!
 * late.js - With-logic templates for JavaScript
 *
 * use {{tags}} to write templates
 *
 * Plain text without any special characters is considered to be local context data that can be any valid js type and
 * when parsed functions are called
 *
 * = Scope identifiers
 * {{#}}				-	Always gives root scope of current template data that is being parsed
 * {{$}}				-	{{each}} block local level scope - this does not seek from parent scope if value is not found
 * {{&}}				-	window scope
 *
 * = Special cases
 * parenthesis			-	When parenthesis is used inside {{}} tags that part is considered to be function call to
 * 							window scope eg. {{if parseInt(10) === 10}} that would use native parseInt function.
 * 							if template data function is required to be called that is just called without any
 * 							parenthesis and parser sees that it's function and passes whole current scope as argument
 *
 * = Special tags
 * {{>[function]]}}		-	Void function call
 * {{% [template]]}}	-	Call template inside template with current data context
 * {{if [arguments]}}	-	If clause that can have valid js reserved words (undefined, true, false, null and
 *							empty string) and call to global scope with &, # or has parenthesis.
 *							Valid operands are &&, ||, ===, !==, <= and => so it has to be type checked data.
 * {{else}}				-	Open if clause can have single else inside current if block
 * {{/if}}				-	Closest open if clause
 * {{each}}				-	Iterate given Object through. Valid values are all items in current scope, &, # or
 *							parenthesis function call. Inside scope data can be accessed by object keys or if value is
 *							not Object then	through {{$value}} and there is always {{$index}} that has current index of
 *							iterated data.
 * {{/each}}			-	Closes each block
 *
 */

(function (global) {
	var tags,
		whiteRe = /\s*/,
		tagRe = /^>|^% |^if |^else|^each |^html |^\//i;

	/*global Element */

	/**
	 * Public object of Late templates
	 * @type {{
	 * 	TYPE_LOG: number,
	 * 	TYPE_NOTICE: number,
	 * 	TYPE_ERROR: number,
	 *	name: string,
	 *	version: string,
	 *	debug: boolean,
	 *	doDebug: (Function|undefined),
	 *	tags: (Array|undefined),
	 *	clearCache: (Function|undefined),
	 *	escape: (Function|undefined),
	 *	exists: (Function|undefined),
	 *	parse: (Function|undefined),
	 *	render: (Function|undefined),
	 *	Scanner: (Scanner|undefined),
	 *	Context: (Context|undefined),
	 *	Writer: (Writer|undefined),
	 *	arrayLength: (Function|undefined)
	 * }}
	 */
	var late = {
		TYPE_LOG: 0,
		TYPE_NOTICE: 1,
		TYPE_ERROR: 2,
		name: 'Late.js',
		version: '0.1',
		debug: true
	};

	var entityMap = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': '&quot;',
		"'": '&#39;',
		"/": '&#x2F;'
	};

	function escapeRegExp(string) {
		return string.replace(/[\-\[\]{}()*+?.,\\\^$|#\s]/g, "\\$&");
	}

	function escapeHtml(string) {
		return String(string).replace(/[&<>"'\/]/g, function (s) {
			return entityMap[s];
		});
	}

	/**
	 * Debugging
	 * @param {*} message
	 */
	function debug(message) {
		console.log(message);
	}

	/**
	 * A simple string scanner that is used by the template parser to find
	 * tokens in template strings.
	 * @constructor
	 */
	function Scanner(string) {
		var fix = string.replace(/ +/g, " ").replace(/\t|\n/g, "");

		this.string = fix;
		this.tail = fix;
		this.pos = 0;
	}

	/**
	 * Returns `true` if the tail is empty (end of string).
	 */
	Scanner.prototype.eos = function () {
		return this.tail === "";
	};

	/**
	 * Tries to match the given regular expression at the current position.
	 * Returns the matched text if it can match, the empty string otherwise.
	 */
	Scanner.prototype.scan = function (re) {
		var match = this.tail.match(re);

		if (match === null) {
			return '';
		}

		var string = match[0];

		this.tail = this.tail.substring(string.length);
		this.pos += string.length;

		return match[0];
	};

	/**
	 * Skips all text until the given regular expression can be matched. Returns
	 * the skipped string, which is the entire tail if no match can be made.
	 * @param {RegExp} re
	 * @return {string}
	 */
	Scanner.prototype.scanUntil = function (re) {
		var index = this.tail.search(re), match;

		switch (index) {
		case -1:
			match = this.tail;
			this.tail = "";
			break;
		case 0:
			match = "";
			break;
		default:
			match = this.tail.substring(0, index);
			this.tail = this.tail.substring(index);
		}

		this.pos += match.length;

		return match;
	};

	/**
	 * Represents a rendering context by wrapping a view object and
	 * maintaining a reference to the parent context.
	 * @constructor
	 * @param {Object|undefined} view
	 * @param {Context} [parentContext]
	 * @param {Context} [root]
	 */
	function Context(view, parentContext, root) {
		this.view = view === undefined ? {} : view;
		this.cache = {'$': this.view};
		this.parent = parentContext;
		this.root = root || this;
		this.window = window;
	}

	/**
	 * Creates a new context using the given view with this context
	 * as the parent.
	 */
	Context.prototype.push = function (view) {
		// Always push most top level Context to next level so Context can be only in two levels
		return new Context(view, this, this.root);
	};

	/**
	 * @param {string} name
	 * @returns {*}
	 */
	Context.prototype.functionCall = function (name) {
		var context = window,
			args = [], i, namespaces, func, parts;

		/*jslint regexp: true*/
		// Is this global namespace function call
		parts = name.split(/\((.*)\)/);

		parts.splice(1, parts.length - 2).forEach(function(item) {
			item.split(',').forEach(function(item) {
				// Check that this is not empty string... requested empty strings have "" or ''
				if (item !== "") {
					args.push(this.lookupWithReserved(item));
				}
			}.bind(this));
		}.bind(this));

		name = parts[0];
		namespaces = name.split(".");
		func = namespaces.pop();

		for(i = 0; i < namespaces.length; i++) {
			try {
				context = context[namespaces[i]];
			} catch(exp) {
				throw new Error(exp + " - " + name);
			}
		}

		if (context === undefined || context[func] === undefined) {
			throw new Error("Tried to executeFunctionByName that does not exist. func: " + name + " args: " + args);
		}

		return context[func].apply(context, args);
	};

	/**
	 * Returns the value of the given name in this context, traversing
	 * up the context hierarchy if the value is absent in this context's view.
	 */
	Context.prototype.lookup = function (name) {
		var firstChar = name[0],
			cache, value, negate, result, context, names, index, self, skipParents;

		if (firstChar === '!') {
			negate = true;
			name = name.substring(1);
			firstChar = name[0];
		}

		// Check if just string
		if (firstChar === "\"" || firstChar === "'") {
			return name.substr(1, name.length - 2);
		}

		if (name.indexOf('(') !== -1) {
			result = this.functionCall(name);
			return negate ? !result : result;
		}

		// If there is # as first character then root context is requested
		if (name[0] === '#') {
			context = this.root;
			name = name.substr(2);
			if (name === "") {
				name = "$";
			}

		} else if (name[0] === '&') {
			context = {
				view: window,
				cache: false
			};
			name = name.substr(2);

		} else {
			context = this;
		}

		cache = context.cache;

		// Check if item has been cached - notice that if item is a function call then it's not cached because
		// function call context requires to be checked always and if items is in window context
		if (cache && cache[name] !== undefined) {
			value = cache[name];
		} else {
			// If only current scope has been requested then skip parents and remove indicator
			if (name[0] === '$' && name[1] === '.') {
				skipParents = true;
				name = name.substr(2);
			}

			while (context) {
				// Self handles this context for function calls that have depth in object tree. Otherwise prototype
				// object calls could have incorrect this context inside function.
				self = context.view;

				if (name.indexOf('.') > 0) {
					value = context.view;
					names = name.split('.');
					index = 0;

					while (value !== undefined && index < names.length) {
						if (index > 0) {
							self = self[names[index - 1]];
						}
						value = value[names[index++]];
					}
				} else {
					value = context.view[name];
				}

				if (value !== undefined) {
					break;
				}

				context = skipParents ? undefined : context.parent;
			}
		}

		if (typeof value === 'function') {
			value = value.call(self);
		} else {
			if (cache !== false) {
				cache[name] = value;
			}
		}

		return negate ? !value : value;
	};

	/**
	 * Do lookup for given name - validate first some of the javascript reserved words, numbers and then normal lookup
	 * @this {Writer}
	 * @param {string|undefined} name
	 * @returns {*}
	 */
	Context.prototype.lookupWithReserved = function(name) {
		var val;

		if (name === 'undefined' || name === undefined) {
			return undefined;
		}
		if (name === 'true') {
			return true;
		}
		if (name === 'false') {
			return false;
		}
		if (name === 'null') {
			return null;
		}

		if ((name[0] === "\"" && name[name.length -1] === "\"") || (name[0] === "'" && name[name.length -1] === "'")) {
			return name.substr(1, name.length - 2);
		}

		val = parseInt(name, 10);

		if (isNaN(val)) {
			return this.lookup(name);
		}

		return val;
	};

	/**
	 * Forms the given array of `tokens` into a nested tree structure where
	 * tokens that represent a section have two additional items: 1) an array of
	 * all tokens that appear in that section and 2) the index in the original
	 * template that represents the end of that section.
	 */
	function nestTokens(tokens) {
		var nestedTokens = [],
			collector = nestedTokens,
			sections = [],
			i, numTokens, token, section;

		for (i = 0, numTokens = tokens.length; i < numTokens; ++i) {
			token = tokens[i];

			if (token[0] === 'if' || token[0] === 'each') {
				collector.push(token);
				sections.push(token);
				collector = token[4] = [];
			} else if (token[0] === '/') {
				section = sections.pop();
				section[5] = token[2];
				collector = sections.length > 0 ? sections[sections.length - 1][4] : nestedTokens;
			} else {
				collector.push(token);
			}
		}

		return nestedTokens;
	}

	/**
	 * Combines the values of consecutive text tokens in the given `tokens` array
	 * to a single token.
	 */
	function squashTokens(tokens) {
		var squashedTokens = [],
			lastToken = [],
			token, i, numTokens;

		for (i = 0, numTokens = tokens.length; i < numTokens; ++i) {
			token = tokens[i];

			if (token) {
				if (token[0] === 'text' && lastToken[0] === 'text') {
					lastToken[1] += token[1];
					lastToken[3] = token[3];
				} else {
					squashedTokens.push(token);
					lastToken = token;
				}
			}
		}

		return squashedTokens;
	}

	/**
	 * Breaks up the given `template` string into a tree of tokens. If the `tags`
	 * argument is given here it must be an array with two string values: the
	 * opening and closing tags used in the template (e.g. [ "{{", "}}" ]).
	 *
	 * A token is an array with at least 4 elements. The first element is the
	 * template tag symbol that was used inside the tag, e.g. "#" or "&". If the tag
	 * did not contain a symbol (i.e. {{myValue}}) this element is "name". For
	 * all text that appears outside a symbol this element is "text".
	 *
	 * The second element of a token is its "value". For template tags this is
	 * whatever else was inside the tag besides the opening symbol. For text tokens
	 * this is the text itself.
	 *
	 * The third and fourth elements of the token are the start and end indices,
	 * respectively, of the token in the original template.
	 *
	 * Tokens that are the root node of a subtree contain two more elements: 1) an
	 * array of tokens in the subtree and 2) the index in the original template at
	 * which the closing tag for that section begins.
	 *
	 * @private
	 * @param {string} template
	 */
	function parseTemplate(template) {
		var sections = [],		 // Stack to hold section tokens
			tokens = [],			 // Buffer to hold the tokens
			tags = late.tags,
			start, type, value, token, openSection;

		if (!template) {
			return [];
		}

		var openingTagRe = new RegExp(escapeRegExp(tags[0]) + '\\s*'),
			closingTagRe = new RegExp('\\s*' + escapeRegExp(tags[1])),
			scanner = new Scanner(template);

		while (!scanner.eos()) {
			start = scanner.pos;

			// Match any text between tags.
			value = scanner.scanUntil(openingTagRe);

			if (value) {
				tokens.push(['text', value, start, value.length]);
				start += value.length;
			}

			// Match the opening tag - Check if there is any opening tags or is this just plain text
			if (!scanner.scan(openingTagRe)) {
				break;
			}

			// Get the tag type.
			type = scanner.scan(tagRe).trim() || 'name';

			// Skip over whitespace if there is some
			scanner.scan(whiteRe);

			// Get the tag value - scan until closing tag
			value = scanner.scanUntil(closingTagRe);

			// Match the closing tag.
			if (!scanner.scan(closingTagRe)) {
				throw new Error('Unclosed tag at ' + scanner.pos);
			}

			token = [type, value.replace(/ /g, ''), start, scanner.pos];
			tokens.push(token);

			if (type === 'if' || type === 'each') {
				sections.push(token);
			} else if (type === '/') {
				// Check section nesting.
				openSection = sections.pop();

				if (!openSection) {
					debug(tokens);
					throw new Error('Unopened section "' + value + '" at ' + start);
				}

				if (openSection[0] !== value) {
					debug(tokens);
					throw new Error('Unclosed section "' + openSection[1] + '" at ' + start);
				}

			} else if (type === '>') {
				token[0] = 'voidFunc';

			} else if (type === 'else') {
				openSection = sections[sections.length - 1];

				if (openSection[0] !== "if") {
					debug(tokens);
					throw new Error('Unopened if section for else "' + value + '" at ' + start);
				}
			} else {
				if (value.indexOf('(') !== -1) {
					token[0] = 'function';
				}
			}
		}

		// Make sure there are no open sections when we're done.
		openSection = sections.pop();

		if (openSection) {
			throw new Error('Unclosed section "' + openSection[1] + '" at ' + scanner.pos);
		}

		return nestTokens(squashTokens(tokens));
	}

	/**
	 * A Writer knows how to take a stream of tokens and render them to a
	 * string, given a context. It also maintains a cache of templates to
	 * avoid the need to parse the same template twice.
	 * @constructor
	 */
	function Writer() {
		this.current = '';

		/**
		 * Cached templates
		 * @type {Object.<{tokens: Array, template: string}|undefined>}
		 */
		this.cache = {};
	}

	/**
	 * Clears all cached templates in this writer.
	 */
	Writer.prototype.clearCache = function () {
		this.cache = {};
	};

	/**
	 * Clears all cached templates in this writer.
	 * @param {string} name
	 */
	Writer.prototype.exists = function (name) {
		return this.cache[name] !== undefined;
	};

	/**
	 * Get whole template data of given template name
	 * @param {string} name
	 * @returns {{tokens: Array, template: string}}
	 */
	Writer.prototype.getTemplate = function (name) {
		if (this.cache[name] === undefined) {
			throw new Error('Late::getTemplate - Given template name does not exist: ' + name);
		}

		return this.cache[name];
	};

	/**
	 * Get tokens of named template
	 * @param name
	 * @returns {Array}
	 */
	Writer.prototype.getTokens = function (name) {
		if (this.cache[name] === undefined) {
			throw new Error('Late::getTokens - Given template name does not exist: ' + name);
		}

		return this.cache[name].tokens;
	};

	/**
	 * Parses and caches the given `template` and returns the array of tokens
	 * that is generated from the parse.
	 * @param {string} name
	 * @param {string} template
	 */
	Writer.prototype.parse = function(name, template) {
		var cache;

		cache = this.cache[name] = {};
		cache.template = template;
		cache.tokens = parseTemplate(template);
	};

	/**
	 * High-level method that is used to render the given `template` with
	 * the given `view`.
	 *
	 * The optional `partials` argument may be an object that contains the
	 * names and templates of partials that are used in the template. It may
	 * also be a function that is used to load partial templates on the fly
	 * that takes a single argument: the name of the partial.
	 * @param {string} templateName
	 * @param {Object|Context} view
	 */
	Writer.prototype.render = function (templateName, view) {
		var data = this.getTemplate(templateName),
			context = (view instanceof Context) ? view : new Context(view);

		this.current = templateName;

		return this.renderTokens(data.tokens, context);
	};

	/**
	 * Handle If clause multi part handling
	 * @param {Array} parts
	 * @param {Context} context
	 * @returns {boolean}
	 */
	Writer.prototype.handleMultiPartIf = function(parts, context) {
		var error;

		parts[0] = context.lookupWithReserved(parts[0]);
		parts[2] = context.lookupWithReserved(parts[2]);

		switch (parts[1]) {
			case '===':
				return parts[0] === parts[2];

			case '!==':
				return parts[0] !== parts[2];

			case '>':
				return parts[0] > parts[2];

			case '>=':
				return parts[0] >= parts[2];

			case '<':
				return parts[0] < parts[2];

			case '<=':
				return parts[0] <= parts[2];

			default:
				error = "template if clause " + JSON.stringify(parts) + " doesn't have valid (===, !==, >, >=, <, <=)";
				late.doDebug(error, late.TYPE_ERROR, this.current);
				throw new Error(error);
		}
	};

	/**
	 * Low-level method that renders the given array of `tokens` using
	 * the given `context` and `partials`.
	 *
	 * Note: The `originalTemplate` is only ever used to extract the portion
	 * of the original template that was contained in a higher-order section.
	 * If the template doesn't use higher-order sections, this argument may
	 * be omitted.
	 * @param {Array} tokens
	 * @param {Context} context
	 * @return {string}
	 */
	Writer.prototype.renderTokens = function (tokens, context) {
		var buffer = '',
			token, value, i, numTokens, j, valueLength, name, parts, apply, x, comp;

		for (i = 0, numTokens = tokens.length; i < numTokens; ++i) {
			token = tokens[i];

			switch (token[0]) {
				case 'voidFunc':
					context.functionCall(token[1]);
					break;

				case 'function':
					buffer += context.functionCall(token[1]);
					break;

				case 'if':
					value = token[4];
					// Split if clause by && and || tokens
					parts = token[1].replace(/ /g, "").split(/(&&|\|\|)/);

					for(x = 0; x < parts.length; x++) {
						if (parts[x] !== '&&' && parts[x] !== '||') {
							comp = parts[x].split(/(===|!==|==|!=|>=|<=|<|>)/);

							if (comp.length === 1) {
								parts[x] = !!context.lookup(comp[0]);

							} else {
								parts[x] = this.handleMultiPartIf(comp, context);
							}

							if (parts[x - 1] === '&&') {
								apply = parts[x - 2] && parts[x];
							} else if (parts[x - 1] === '||') {
								apply = parts[x - 2] || parts[x];

							} else {
								apply = parts[x];
							}
						}
					}

					// check if there is else
					for (j = 0; j < token[4].length; j++) {
						if (token[4][j][0] === "else") {
							value = apply ? token[4].slice(0, j) : token[4].slice(j + 1, token[4].length);
							apply = true;
							break;
						}
					}

					if (apply) {
						buffer += this.renderTokens(value, context);
					}
					break;

				case 'each':
					value = context.lookup(token[1]);

					if (!value) {
						break;
					}

					if (typeof value === 'function') {
						// Handle function call and push it to value - response handled normally through renderTokens
						value = value.call(context.view);

						// If response is undefined then pass
						if (value === undefined) {
							break;
						}
					}

					if (typeof value === 'object') {
						if (Array.isArray(value)) {
							for (j = 0, valueLength = value.length; j < valueLength; ++j) {
								if (typeof value[j] === 'object') {
									value[j].$index = j;
									apply = value[j];
								} else {
									apply = {"$index": j, "$value": value[j]};
								}

								buffer += this.renderTokens(token[4],
										context.push(apply));
							}

						} else {
							x = Object.keys(value);

							for (j = 0, valueLength = x.length; j < valueLength; ++j) {
								if (typeof value[x[j]] === 'object' && value[x[j]] !== null) {
									value[x[j]].$index = x[j];
									apply = value[x[j]];
								} else {
									apply = {"$index": x[j], "$value": value[x[j]]};
								}

								buffer += this.renderTokens(token[4],
										context.push(apply));
							}
						}

					} else {
						buffer += this.renderTokens(token[4], context.push(value));
					}
					break;

				case '%':
					try {
						value = this.getTemplate(token[1]);
					} catch (e) {
						throw new Error('Late::getTokens - Requested inner template name does not exist: ' + token[1]);
					}

					buffer += this.renderTokens(value.tokens, context);
					break;

				case 'html':
					value = context.lookup(token[1]);

					if (value !== undefined) {
						buffer += value instanceof Element ? value.outerHTML : value;
					}
					break;

				case 'name':
					if (token[1].indexOf('[') > 0) {
						parts = token[1].split(/\[|\]/);
						value = context.lookup(parts[0])[context.lookup(parts[1]) || parts[1]];

					} else {
						value = context.lookup(token[1]);
					}

					if (value !== null) {
						buffer += late.escape(value);
					} else {
						if (late.debug === true) {
							late.doDebug(token[1] + ' - named token could not be found from view data',
									late.TYPE_NOTICE, this.current);
						}
					}
					break;

				case 'text':
					buffer += token[1];
					break;
			}
		}

		return buffer;
	};

	// All high-level mustache.* functions use this writer.
	var defaultWriter = new Writer();

	// Define default tags here so that those can be set visible to object and still have setter/getter
	tags = ['{{', '}}'];

	/**
	 * Define default tags and create setter to validate input if overridden
	 * @memberOf window.Late
	 * @type {Array}
	 */
	late.tags = tags;

	// Define default properties
	Object.defineProperties(late, {
		name: {
			writable: false
		},
		version: {
			writable: false
		},
		tags: {
			get: function() {
				return tags;
			},
			set: function(override) {
				if (!Array.isArray(override) || override.length !== 2) {
					throw new Error('Invalid tags: ' + JSON.stringify(override));
				}

				tags = override;
			}
		}
	});

	/**
	 * Write debug
	 * @param {string} message
	 * @param {number} [errorLevel]
	 * @param {string} [template]
	 */
	late.doDebug = function(message, errorLevel, template) {
		if (late.debug !== false) {
			var identify = template ? 'Late.js template: ' + template + ' - ': 'Late.js - ';

			errorLevel = errorLevel || 0;

			if (late.debug === true || late.debug >= errorLevel) {
				switch (errorLevel) {
					case 0:
						console.log(identify + message);
						break;

					case 1:
						console.info(identify + message);
						break;

					case 2:
						console.error(identify + message);
						break;
				}
			}
		}
	};

	/**
	 * Clears all cached templates in the default writer.
	 * @function
	 * @memberOf window.Late
	 */
	late.clearCache = function () {
		defaultWriter.clearCache();
	};

	/**
	 * Does given name template exist in cache
	 * @function
	 * @memberOf window.Late
	 * @param {string} name
	 * @return {boolean}
	 */
	late.exists = function (name) {
		return defaultWriter.exists(name);
	};

	/**
	 * Parses and caches the given template in the default writer and returns the
	 * array of tokens it contains. Doing this ahead of time avoids the need to
	 * parse templates on the fly as they are rendered.
	 * @memberOf window.Late
	 * @param {string} name
	 * @param {string} template
	 * @return {boolean}
	 */
	late.parse = function (name, template) {
		return defaultWriter.parse(name, template);
	};

	/**
	 * Renders the `template` with the given `view` and `partials` using the
	 * default writer.
	 * @memberOf window.Late
	 * @function
	 * @param {string} [name]
	 * @param {Object} [view]
	 */
	late.render = function (name, view) {
		return defaultWriter.render(name, view);
	};

	/**
	 * Export the escaping function so that the user may override it.
	 * @memberOf window.Late
 	 */
	late.escape = escapeHtml;

	/**
	 * @memberOf window.Late
	 * @type {Scanner}
	 */
	late.Scanner = Scanner;

	/**
	 * @memberOf window.Late
	 * @type {Context}
	 */
	late.Context = Context;

	/**
	 * @memberOf window.Late
	 * @type {Writer}
	 */
	late.Writer = Writer;

	/**
	 * get array length in template where required object comes from function
	 * @param object
	 * @returns {number|boolean}
	 */
	late.arrayLength = function(object) {
		return (Array.isArray(object)) ? object.length : false;
	};

	/**
	 * Set Late.js public object to global Late namespace
	 */
	global.Late = late;
}(window));

