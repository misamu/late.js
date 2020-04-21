/*!
 * late.js - With-logic templates for JavaScript
 * https://github.com/misamu/late.js
 * version 0.3
 *
 * Fork of mustache.js - Logic-less {{mustache}} templates with JavaScript
 * http://github.com/janl/mustache.js
 *
 * Licence: MIT
 */

/**
 * Use {{tags}} to write templates
 *
 * Plain text without any special characters is considered to be local context data that can be any valid js type and
 * when parsed functions are called
 *
 *
 * = Scope identifiers
 * {{#}}                -  Always gives root scope of current template data that is being parsed
 * {{$}}                -  {{each}} {{get}} block local level scope - this does not seek from parent scope if value is not found
 * {{&}}                -  window scope
 *
 * = Special cases
 * parenthesis          -  When parenthesis is used inside {{}} tags that part is considered to be function call to
 *                         window scope eg. {{if parseInt(10) === 10}} that would use native parseInt function.
 *                         if template data function is required to be called that is just called without any
 *                         parenthesis and parser sees that it's function and passes whole current scope as argument
 *
 * = Special tags
 * {{> [function]]}}     - Void function call
 * {{>> [function]]}}    - Function call with return value
 * {{% [template]]}}    -  Call template inside template with current data context
 * {{if [arguments]}}   -  If clause that can have valid js reserved words (undefined, true, false, null and
 *                          empty string) and call to global scope with &, # or has parenthesis.
 *                          Valid operands are &&, ||, ===, !==, <= and => so it has to be type checked data.
 * {{else}}             -  Open if clause can have single else inside current if block
 * {{/if}}              -  Closest open if clause
 * {{each}}             -  Iterate given Object through. Valid values are all items in current scope, &, # or
 *                         parenthesis function call. Inside scope data can be accessed by object keys or if value is
 *                         not Object then	through {{$value}} and there is always {{$index}} that has current index of
 *                         iterated data.
 * {{/each}}            -  Closes each block
 * {{get}}              -  Get given item value and make it as a new scope. For example function call return value
 *                         goes to $ and gives easy access to that value
 * {{/get}}             -  Closes get block
 *
 */

'use strict'; // jshint ignore:line
(function(window) {
	/**
	 * @typedef {Writer} lateWriter
	 */

	/**
	 * @typedef {Context} lateContext
	 */

	/**
	 * Log level debug
	 * @type {number}
	 */
	const TYPE_DEBUG = 0;

	/**
	 * Log level error
	 * @type {number}
	 */
	const TYPE_ERROR = 1;

	/**
	 * Whitespace regexp
	 * @type {RegExp}
	 */
	const whiteRe = /\s*/;

	/**
	 * Tag list parsed except else and closing / that are special tags that do not have space before closing }}
	 * @type {string[]}
	 */
	const tagReList = ['>', '>>', '%', 'if', 'html', 'each', 'get', 'promise'];

	/**
	 * RegExp for special tags built from tagReList
	 * @type {RegExp}
	 */
	let tagRe = new RegExp(`^${tagReList.join(' |^')}|^else|^\/`, 'i');

	// Define default tags here so that those can be set visible to object and still have setter/getter
	let tags = ['{{', '}}'];

	/**
	 * Token handler for token rendered
	 * @see Writer.renderTokens
	 * @type {Object}
	 */
	const tokenHandlers = Object.create(null);

	/**
	 * Promise callback print element
	 * @type {number}
	 */
	let promiseElementId = 0;

	/**
	 * @type {Object}
	 */
	const late = Object.create(null, {
		/**
		 * Library name
		 */
		name: {
			value: 'late.js',
			writable: false
		},

		/**
		 * Library name
		 */
		printDebugLevel: {
			value: 1,
			writable: true
		},

		/**
		 * Library name
		 */
		version: {
			value: '0.2',
			writable: false
		}
	});

	/**
	 * Write debug
	 * @param {string} message
	 * @param {number} [errorLevel=0]
	 * @param {string} [template]
	 */
	function consoleMessage(message, errorLevel, template) {
		const identify = template ? `[template: ${template}] ` : ``;

		errorLevel = errorLevel || 0;

		if (late.printDebugLevel >= errorLevel) {
			switch (errorLevel) {
				case 0:
					console.log(`late.js: ${identify}${message}`);
					break;

				case 1:
					console.error(`late.js: ${identify}${message}`);
					break;
			}
		}
	}

	const entityMap = {
		"&": `&amp;`,
		"<": `&lt;`,
		">": `&gt;`,
		"'": `&#39;`,
		"/": `&#x2F;`,
		"\"": `&quot;`
	};

	function escapeRegExp(string) {
		return string.replace(/[\-\[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
	}

	function escapeHtml(string) {
		return String(string).replace(/[<>"']/g, function(s) {
			return entityMap[s];
		});
	}

	/**
	 * A simple string scanner that is used by the template parser to find
	 * tokens in template strings.
	 * @constructor
	 */
	function Scanner(string) {
		const fix = string.replace(/ +/g, " ").replace(/[\t\n]/g, "");

		this.string = fix;
		this.tail = fix;
		this.pos = 0;
	}

	/**
	 * Returns `true` if the tail is empty (end of string).
	 */
	Scanner.prototype.eos = function() {
		return this.tail === '';
	};

	/**
	 * Tries to match the given regular expression at the current position.
	 * Returns the matched text if it can match, the empty string otherwise.
	 */
	Scanner.prototype.scan = function(re) {
		const match = this.tail.match(re);

		if (match === null) {
			return '';
		}

		const string = match[0];

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
	Scanner.prototype.scanUntil = function(re) {
		const index = this.tail.search(re);
		let match;

		switch (index) {
		case -1:
			match = this.tail;
			this.tail = '';
			break;
		case 0:
			match = '';
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
		/**
		 * @type {Object}
		 */
		this.view = view === undefined ? Object.create(null) : view;

		/**
		 * @type {Context}
		 */
		this.parent = parentContext;

		/**
		 * @type {Context}
		 */
		this.root = root || this;

		this.cache = {'$': this.view};
		this.window = window;
	}

	/**
	 * Set new root context
	 * @param {Context} context
	 */
	Context.prototype.setRoot = function(context) {
		this.root = (context instanceof Context) ? context : this.root;
	};

	/**
	 * Creates a new context using the given view with this context
	 * as the parent.
	 * @return {Context}
	 */
	Context.prototype.push = function(view) {
		// Always push most top level Context to next level so Context can be only in two levels
		return new Context(view, this, this.root);
	};

	/**
	 * @param {string} name
	 * @returns {*}
	 */
	Context.prototype.functionCall = function(name) {
		let result, negate, args = [];

		if (name[0] === '!') {
			negate = true;
			name = name.substring(1);
		}

		try {
			/*jslint regexp: true*/
			// Is this window namespace function call
			let parts = name.split(/\((.*)\)/);

			// If there is more than one item in parameters then take those and iterate through
			if (parts[1] !== "" && parts[1] !== undefined) {
				let parseArgs = parts[1].split(',');

				for (let x = 0; x < parseArgs.length; x++) {
					// Check that this is not empty string... requested empty strings have "" or ''
					if (parseArgs[x] !== "") {
						args.push(this.lookupWithReserved(parseArgs[x]));
					}
				}
			}

			name = parts[0];

			// If function call is to the templateData context
			if (name[0] !== '$' && name[0] !== '#') {
				let namespaces = name.split(".");
				let context = window;
				let func = namespaces.pop();

				for (let i = 0; i < namespaces.length; i++) {
					context = context[namespaces[i]];
				}

				result = context[func].apply(context, args);

			} else {
				result = this.lookup(name, args);
			}

			return (negate) ? !result : result;

		} catch(/*Error*/error) {
			consoleMessage(`functionCall exception [Name: ${error.name}] [Func: ${name}] [Msg: ${error.message}]`,
					TYPE_ERROR, this.current);
		}
	};

	/**
	 * Returns the value of the given name in this context, traversing
	 * up the context hierarchy if the value is absent in this context's view.
	 */
	Context.prototype.lookup = function(name, args) {
		let firstChar = name[0],
			cache, value, negate, context, functionPath;

		// Check first if function because it has own negate system
		if (name.indexOf('(') !== -1) {
			return this.functionCall(name);
		}

		if (firstChar === '!') {
			negate = true;
			name = name.substring(1);
			firstChar = name[0];
		}

		// Check if just string
		if (firstChar === '"' || firstChar === "'") {
			return name.substr(1, name.length - 2);
		}

		// If there is # as first character then root context is requested
		if (firstChar === '#') {
			context = this.root;
			name = name.substr(2);
			if (name === '') {
				name = '$';
			}

		} else if (firstChar === '&') {
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
			let skipParents;

			// If only current scope has been requested then skip parents and remove indicator
			if (name[0] === '$' && name[1] === '.') {
				skipParents = true;
				name = name.substr(2);
			}

			while (context) {
				// Self handles this context for function calls that have depth in object tree. Otherwise prototype
				// object calls could have incorrect this context inside function.
				functionPath = context.view;

				if (name.indexOf('.') > 0) {
					let index = 0;
					let names = name.split('.');

					value = context.view;

					while (value !== undefined && index < names.length) {
						if (index > 0) {
							functionPath = functionPath[names[index - 1]];
						}

						value = value[names[index++]];
					}
				} else {
					value = context.view[name];
				}

				// If there is value or should skip parents then bail out
				if (value !== undefined || skipParents) {
					break;
				}

				context = context.parent;

				// If parent context was undefined but there is a root then go there and mark that after this get out
				// because this.root would otherwise generate loop
				if (context === undefined && this.root !== undefined) {
					context = this.root;
					skipParents = true;
				}
			}
		}

		if (typeof value === 'function') {
			value = value.apply(functionPath, args || []);
		} else {
			if (cache !== false) {
				cache[name] = value;
			}
		}

		return negate ? !value : value;
	};

	/**
	 * Do lookup for given name - validate first some of the javascript reserved words, numbers and then normal lookup
	 * @param {*} name
	 * @returns {*}
	 */
	Context.prototype.lookupWithReserved = function(name) {
		switch(name) {
			case undefined:
			case 'undefined':
				return undefined;

			case true:
			case 'true':
				return true;

			case false:
			case 'false':
				return false;

			case null:
			case 'null':
				return null;
		}

		// Check if number
		if (!isNaN(name)) {
			return parseInt(name, 10);
		}

		return this.lookup(name);
	};

	/**
	 * Forms the given array of `tokens` into a nested tree structure where
	 * tokens that represent a section have two additional items: 1) an array of
	 * all tokens that appear in that section and 2) the index in the original
	 * template that represents the end of that section.
	 */
	function nestTokens(tokens) {
		let nestedTokens = [],
			collector = nestedTokens,
			sections = [],
			i, numTokens, token, section;

		for (i = 0, numTokens = tokens.length; i < numTokens; ++i) {
			token = tokens[i];

			if (token[0] === 'if' || token[0] === 'each' || token[0] === 'get' || token[0] === 'promise') {
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
		let squashedTokens = [],
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
	 * @param {string} name
	 * @param {string} template
	 */
	function parseTemplate(name, template) {
		let sections = [],		 // Stack to hold section tokens
			tokens = [],			 // Buffer to hold the tokens
			start, type, value, token, openSection;

		if (!template) {
			return [];
		}

		let openingTagRe = new RegExp(escapeRegExp(tags[0]) + '\\s*'),
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
				consoleMessage(`Unclosed tag at ${scanner.pos}`, TYPE_ERROR, name);
			}

			token = [type, value.replace(/ /g, ''), start, scanner.pos];
			tokens.push(token);

			switch(type) {
				case 'if':
				case 'each':
				case 'get':
				case 'promise':
					sections.push(token);
					break;

				case '/':
					// Check section nesting.
					openSection = sections.pop();

					if (!openSection) {
						consoleMessage(`Unopened section ${value}:${start}`, TYPE_ERROR, name);
						consoleMessage(JSON.stringify(tokens), TYPE_DEBUG, name);
					}

					if (openSection[0] !== value) {
						consoleMessage(`Unclosed section ${openSection[1]}:${start}`, TYPE_ERROR, name);
						consoleMessage(JSON.stringify(tokens), TYPE_DEBUG, name);
					}
					break;

				case 'else':
					openSection = sections[sections.length - 1];

					if (openSection[0] !== "if") {
						consoleMessage(`Unopened if section for else ${value}:${start}`, TYPE_ERROR, name);
						consoleMessage(JSON.stringify(tokens), TYPE_DEBUG, name);
					}
					break;

				default:
					if (tagReList.indexOf(type) !== -1) {
						token[0] = type;
					}
					break;
			}
		}

		// Make sure there are no open sections when we're done.
		openSection = sections.pop();

		if (openSection) {
			consoleMessage(`Unclosed section "${openSection[1]}" at ${scanner.pos}`, TYPE_ERROR, name);
		}

		return nestTokens(squashTokens(tokens));
	}

	/**
	 * A Writer knows how to take a stream of tokens and render them to a
	 * string, given a context. It also maintains a cache of templates to
	 * avoid the need to parse the same template twice.
	 * @constructor
	 * @this {Writer}
	 */
	function Writer() {
		this.current = '';

		/**
		 * Cached templates
		 * @type {Object.<{tokens: Array, template: string}|undefined>}
		 */
		this.cache = Object.create(null);
	}

	/**
	 * Clears all cached templates in this writer.
	 */
	Writer.prototype.clearCache = function() {
		this.cache = Object.create(null);
	};

	/**
	 * Clears all cached templates in this writer.
	 * @param {string} name
	 */
	Writer.prototype.exists = function(name) {
		return this.cache[name] !== undefined;
	};

	/**
	 * Get whole template data of given template name
	 * @param {string} name
	 * @returns {{tokens: Array, template: string}}
	 */
	Writer.prototype.getTemplate = function(name) {
		if (this.cache[name] === undefined) {
			consoleMessage(`getTemplate - Given template name does not exist: ${name}`, TYPE_ERROR, this.current);
		}

		return this.cache[name];
	};

	//noinspection JSUnusedGlobalSymbols
	/**
	 * Get tokens of named template
	 * @param name
	 * @returns {Array}
	 */
	Writer.prototype.getTokens = function(name) {
		if (this.cache[name] === undefined) {
			consoleMessage(`getTokens - Given template name does not exist: ${name}`, TYPE_ERROR, this.current);
		}

		return this.cache[name].tokens;
	};

	/**
	 * Get list of all templates in cache
	 * @returns {Array}
	 */
	Writer.prototype.listTemplates = function() {
		return Object.keys(this.cache);
	};

	/**
	 * Parses and caches the given `template` and returns the array of tokens
	 * that is generated from the parse.
	 * @param {string} name
	 * @param {string} template
	 */
	Writer.prototype.parse = function(name, template) {
		const cache = this.cache[name] = Object.create(null);
		cache.template = template;
		cache.tokens = parseTemplate(name, template);
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
	Writer.prototype.render = function(templateName, view) {
		let data = this.getTemplate(templateName),
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
				let error = "template if clause " + JSON.stringify(parts) + " doesn't have valid (===, !==, >, >=, <, <=)";
				consoleMessage(error, TYPE_ERROR, this.current);
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
	Writer.prototype.renderTokens = function(tokens, context) {
		let buffer = '';

		const numTokens = tokens.length;

		for (let i = 0; i < numTokens; ++i) {
			const token = tokens[i];

			// Check if there is token handler registered
			if (tokenHandlers[token[0]]) {
				let handlerResponse = tokenHandlers[token[0]](token, context, this);

				// Some response that is not undefined so append to buffer
				if (handlerResponse !== undefined) {
					buffer += handlerResponse;
				}
			}
		}

		return buffer;
	};

	// Default writer
	const defaultWriter = new Writer();

	/**
	 * Void function call
	 * @param {Array} token
	 * @param {Context} context
	 */
	tokenHandlers['>'] = function(token, context) {
		context.functionCall(token[1]);
	};

	/**
	 * Function call
	 * @param {Array} token
	 * @param {Context} context
	 * @return {*}
	 */
	tokenHandlers['>>'] = function(token, context) {
		return context.functionCall(token[1]);
	};

	/**
	 * Inner template
	 * @param {Array} token
	 * @param {Context} context
	 * @param {Writer} writer
	 * @return {*}
	 */
	tokenHandlers['%'] = function(token, context, writer) {
		/**
		 * Check first if template name could come from data set of template and if not then use as is
		 * @type {string}
		 */
		const templateName = context.lookup(token[1]) || token[1];

		const value = writer.getTemplate(templateName);

		if (value === undefined) {
			consoleMessage(`Inner token handler [%${templateName}] not found`, TYPE_ERROR, this.current);
			return;
		}

		return writer.renderTokens(value.tokens, context);
	};

	/**
	 * each loop
	 * @param {Array} token
	 * @param {Context} context
	 * @param {Writer} writer
	 * @return {*}
	 */
	tokenHandlers.each = function(token, context, writer) {
		let buffer = '';

		let value = context.lookup(token[1]);

		if (!value) {
			return;
		}

		if (typeof value === 'function') {
			// Handle function call and push it to value - response handled normally through renderTokens
			value = value.call(context.view);

			// If response is undefined then pass
			if (value === undefined) {
				return;
			}
		}

		// If Array or object then iterate
		if (typeof value === 'object') {
			// Handle Array iteration
			if (Array.isArray(value)) {
				for (let x = 0, valueLength = value.length; x < valueLength; ++x) {
					let apply;

					if (typeof value[x] === 'object') {
						value[x].$index = x;
						apply = value[x];
					} else {
						apply = {"$index": x, "$value": value[x]};
					}

					buffer += writer.renderTokens(token[4], context.push(apply));
				}
			} else {
				const keys = Object.keys(value);

				for (let x = 0, valueLength = keys.length; x < valueLength; ++x) {
					buffer += writer.renderTokens(token[4], context.push({"$index": keys[x], "$value": value[keys[x]]}));
				}
			}

			return buffer;
		}

		// this will just give simple way to access object through $ if object comes from for example function
		return writer.renderTokens(token[4], context.push(value));
	};

	/**
	 * Promise handle and loop all items
	 * @param {Array} token
	 * @param {Context} context
	 * @param {Writer} writer
	 * @return {*}
	 */
	tokenHandlers.promise = function(token, context, writer) {
		const promise = context.lookup(token[1]);

		if (promise instanceof Promise) {
			promise.then(function(users) {
				let buffer = '';

				if (Array.isArray(users)) {
					for (let x = 0; x < users.length; ++x) {
						buffer += writer.renderTokens(token[4], context.push(users[x]));
					}

				} else {
					buffer += writer.renderTokens(token[4], context.push(users));
				}

				const container = document.getElementById(`latePromise-${this}`);
				container.innerHTML = buffer;
				container.parentNode.replaceChild(document.importNode(container.content, true), container);

			}.bind(promiseElementId)).catch(function(error) {
				consoleMessage(`late::tokenHandler promise [${token[1]}] exception [${JSON.stringify(error)}]`, TYPE_ERROR);
			});

			return `<template id="latePromise-${promiseElementId++}"></template>`;
		}

		consoleMessage(`late::tokenHandler promise [${token[1]}] is not a Promise`, TYPE_ERROR);
		return '';
	};

	/**
	 * Get value block and use it through #
	 * @param {Array} token
	 * @param {Context} context
	 * @param {Writer} writer
	 * @return {*}
	 */
	tokenHandlers.get = function(token, context, writer) {
		const value = context.lookup(token[1]);

		if (!value) {
			return;
		}

		// this will just give simple way to access object through $ if object comes from for example function
		return writer.renderTokens(token[4], context.push(value));
	};

	/**
	 * HTML parsing
	 * @param {Array} token
	 * @param {Context} context
	 * @return {*}
	 */
	tokenHandlers.html = function(token, context) {
		const value = context.lookup(token[1]);

		return value instanceof Element ? value.outerHTML : value;
	};

	/**
	 * if clause
	 * @param {Array} token
	 * @param {Context} context
	 * @param {Writer} writer
	 * @return {*}
	 */
	tokenHandlers.if = function(token, context, writer) {
		let apply = false;

		let value = token[4];

		// Split if clause by && and || tokens
		const parts = token[1].replace(/ /g, "").split(/(&&|\|\|)/);

		// If there is no AND or OR items in the clause then just do simple check for that value
		if (parts.length === 1) {
			let comp = parts[0].split(/(===|!==|==|!=|>=|<=|<|>)/);

			// Checking just if one value is true or false
			if (comp.length === 1) {
				apply = !!context.lookup(comp[0]);

			} else {
				// comparison between two values found
				apply = writer.handleMultiPartIf(comp, context);
			}

		} else {
			let x = 0;

			do {
				if (parts[x] !== '&&' && parts[x] !== '||') {
					let comp = parts[x].split(/(===|!==|==|!=|>=|<=|<|>)/);

					if (comp.length === 1) {
						parts[x] = !!context.lookupWithReserved(comp[0]);

					} else {
						parts[x] = writer.handleMultiPartIf(comp, context);
					}

					// Check if previous is && then can parse correct value for this item by AND check
					if (x !== 0 && parts[x - 1] === '&&') {
						parts[x] = parts[x - 2] && parts[x];
					}

					// If there is no more items and last item is true then clause is true
					if (x === parts.length - 1) {
						if (parts[x]) {
							apply = true;
							break;
						}
					}

					x++;
					continue;
				}

				// If given position is true and next is or then clause is true
				if (parts[x - 1] === true && parts[x] === '||') {
					apply = true;
					break;
				}

				// Continue to next item
				x++;

			} while (x < parts.length);
		}

		// Search if else token found and slice correct token set to be returned
		for (let x = 0; x < token[4].length; x++) {
			if (token[4][x][0] === "else") {
				value = apply ? token[4].slice(0, x) : token[4].slice(x + 1, token[4].length);
				apply = true;
				break;
			}
		}

		if (apply) {
			return writer.renderTokens(value, context);
		}
	};

	/**
	 * Name parser
	 * @param {Array} token
	 * @param {Context} context
	 * @return {*}
	 */
	tokenHandlers.name = function(token, context) {
		let value;

		if (token[1].indexOf('[') > 0) {
			let parts = token[1].split(/[\[\]]/);
			value = context.lookup(parts[0])[context.lookup(parts[1]) || parts[1]];

		} else {
			value = context.lookup(token[1]);
		}

		return escapeHtml(value);
	};

	/**
	 * Plain text
	 * @param {Array} token
	 * @return {*}
	 */
	tokenHandlers.text = function(token) {
		return token[1];
	};


	/**
	 * Set/get tags to parse
	 */
	late.tags = {
		get: function () {
			return tags;
		},
		set: function (override) {
			if (!Array.isArray(override) || override.length !== 2) {
				consoleMessage(`Invalid tags: ${JSON.stringify(override)}`, TYPE_ERROR);
			}

			tags = override;
		}
	};

	/**
	 * Add new token handler
	 * Added function has access as parameters to token:Array, context:Context and writer:Writer
	 * @param {string} name
	 * @param {Function} handler
	 */
	late.addTokenHandler = function(name, handler) {
		if (tagReList.indexOf(name) === -1) {
			tagReList.push(name);
			tagRe = new RegExp(`^${tagReList.join(' |^')}|^else|^\/`, 'i');
			tokenHandlers[name] = handler;

		} else {
			consoleMessage(`late::addTokenHandler [${name}] already exists as token handler`, TYPE_ERROR);
		}
	};

	/**
	 * Clears all cached templates in the default writer.
	 */
	late.clearCache = function() {
		defaultWriter.clearCache();
	};

	/**
	 * Does given name template exist in cache
	 * @param {string} name
	 * @return {boolean}
	 */
	late.exists = function(name) {
		return defaultWriter.exists(name);
	};

	/**
	 * List all templates
	 * @returns {Array}
	 */
	late.listTemplates = function() {
		return defaultWriter.listTemplates();
	};

	/**
	 * Parses and caches the given template in the default writer and returns the
	 * array of tokens it contains. Doing this ahead of time avoids the need to
	 * parse templates on the fly as they are rendered.
	 * @param {string} name
	 * @param {string} template
	 */
	late.parse = function(name, template) {
		return defaultWriter.parse(name, template);
	};

	/**
	 * Renders the `template` with the given `view` and `partials` using the
	 * default writer.
	 * @param {string} [name]
	 * @param {Object} [view]
	 */
	late.render = function(name, view) {
		return defaultWriter.render(name, view);
	};

	/**
	 * Export the escaping function so that the user may override it.
	 * @function
 	 */
	late.escape = escapeHtml;

	/**
	 * get array length in template where required object comes from function
	 * @param object
	 * @returns {number|boolean}
	 */
	late.arrayLength = function(object) {
		return (Array.isArray(object)) ? object.length : false;
	};

	/**
	 * Check if given data is object
	 * @param {*} needle
	 * @param {Array} haystack
	 * @returns {boolean}
	 */
	late.inArray = function(needle, haystack) {
		return haystack.indexOf(needle) !== -1;
	};

	/**
	 * Check if given data is object
	 * @param {*} data
	 * @returns {number|boolean}
	 */
	late.isObject = function(data) {
		return (typeof data === 'object');
	};

	/**
	 * Create new context that can be used with addTokenHandler to override data mainly with sub templates
	 * @param {Object} view
	 * @param {Context} [parent]
	 * @param {Context} [root]
	 * @return {Context}
	 */
	late.newContext = function(view, parent, root) {
		if (parent === undefined) {
			return new Context(view, parent, root);
		}

		/**
		 * Create new context with view data and parent Context
		 * @type {Context}
		 */
		let context = parent.push(view);

		context.setRoot(root);

		return context;
	};

	/**
	 * Set late.js public object to window late namespace
	 * @global late
	 */
	window.late = late;
}(window));

