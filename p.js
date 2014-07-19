/*!
 * Copyright 2013 Robert Katić
 * Released under the MIT license
 * https://github.com/rkatic/p/blob/master/LICENSE
 *
 * High-priority-tasks code-portion based on https://github.com/kriskowal/asap
 * Long-Stack-Support code-portion based on https://github.com/kriskowal/q
 */
;(function( factory ){
	// CommonJS
	if ( typeof module !== "undefined" && module && module.exports ) {
		module.exports = factory();

	// RequireJS
	} else if ( typeof define === "function" && define.amd ) {
		define( factory );

	// global
	} else {
		P = factory();
	}
})(function() {
	"use strict";

	var pStartingLine = captureLine(),
		pFileName,
		currentTrace = null;

	function getTrace() {
		var stack = new Error().stack;
		if ( !stack ) {
			return null;
		}

		var stacks = [ filterStackString( stack, 1 ) ];

		if ( currentTrace ) {
			stacks = stacks.concat( currentTrace );

			if ( stacks.length === 128 ) {
				stacks.pop();
			}
		}

		return stacks;
	}

	function getFileNameAndLineNumber( stackLine ) {
		var m =
			/at .+ \(([\s\S]+):(\d+):(?:\d+)\)$/.exec( stackLine ) ||
			/at ([^ ]+):(\d+):(?:\d+)$/.exec( stackLine ) ||
			/@([\s\S]+):(\d+):(?:\d+)$/.exec( stackLine );

		return m ? { fileName: m[1], lineNumber: Number(m[2]) } : null;
	}

	function captureLine() {
		var stack = new Error().stack;
		if ( !stack ) {
			return 0;
		}

		var lines = stack.split("\n");
		var firstLine = lines[0].indexOf("@") > 0 ? lines[1] : lines[2];
		var pos = getFileNameAndLineNumber( firstLine );
		if ( !pos ) {
			return 0;
		}

		pFileName = pos.fileName;
		return pos.lineNumber;
	}

	function filterStackString( stack, ignoreFirstLines ) {
		var lines = stack.split("\n");
		var goodLines = [];

		for ( var i = ignoreFirstLines|0, l = lines.length; i < l; ++i ) {
			var line = lines[i];

			if ( line && !isNodeFrame(line) && !isInternalFrame(line) ) {
				goodLines.push( line );
			}
		}

		return goodLines.join("\n");
	}

	function isNodeFrame( stackLine ) {
		return stackLine.indexOf("(module.js:") !== -1 ||
			   stackLine.indexOf("(node.js:") !== -1;
	}

	function isInternalFrame( stackLine ) {
		var pos = getFileNameAndLineNumber( stackLine );
		return !!pos &&
			pos.fileName === pFileName &&
			pos.lineNumber >= pStartingLine &&
			pos.lineNumber <= pEndingLine;
	}

	var STACK_JUMP_SEPARATOR = "\nFrom previous event:\n";

	function makeStackTraceLong( error ) {
		if (
			error instanceof Error &&
			error.stack &&
			error.stack.indexOf(STACK_JUMP_SEPARATOR) === -1
		) {
			error.stack = [ filterStackString( error.stack, 0 ) ]
				.concat( currentTrace || [] )
				.join(STACK_JUMP_SEPARATOR);
		}
	}

	//__________________________________________________________________________

	var
		isNodeJS = ot(typeof process) && process != null &&
			({}).toString.call(process) === "[object process]",

		hasSetImmediate = typeof setImmediate === "function",

		gMutationObserver =
			ot(typeof MutationObserver) && MutationObserver ||
			ot(typeof WebKitMutationObserver) && WebKitMutationObserver,

		head = new TaskNode(),
		tail = head,
		flushing = false,
		nFreeTaskNodes = 0,

		requestFlush =
			isNodeJS ? requestFlushForNodeJS :
			gMutationObserver ? makeRequestCallFromMutationObserver( flush ) :
			makeRequestCallFromTimer( flush ),

		pendingErrors = [],
		requestErrorThrow = makeRequestCallFromTimer( throwFirstError ),

		handleError,

		domain,

		call = ot.call,
		apply = ot.apply;

	tail.next = head;

	function TaskNode() {
		this.task = null;
		this.a = null;
		this.b = null;
		this.domain = null;
		this.trace = null;
		this.next = null;
	}

	function ot( type ) {
		return type === "object" || type === "function";
	}

	function throwFirstError() {
		if ( pendingErrors.length ) {
			throw pendingErrors.shift();
		}
	}

	function flush() {
		while ( head !== tail ) {
			var h = head = head.next;

			if ( nFreeTaskNodes >= 1024 ) {
				tail.next = tail.next.next;
			} else {
				++nFreeTaskNodes;
			}

			currentTrace = h.trace;

			if ( h.domain ) {
				runInDomain( h.domain, h.task, h.a, h.b );
				h.domain = null;

			} else {
				(1,h.task)( h.a, h.b );
			}

			h.task = null;
			h.a = null;
			h.b = null;
			h.trace = null;
		}

		flushing = false;
		currentTrace = null;
	}

	function beforeThrow() {
		head.task = null;
		head.a = null;
		head.b = null;
		head.domain = null;
		head.trace = null;
		requestFlush();
	}

	function runInDomain( domain, task, a, b ) {
		if ( domain._disposed ) {
			return;
		}
		domain.enter();
		task( a, b );
		domain.exit();
	}

	function queueTask( task, a, b ) {
		queueTask_(
			task, a, b,
			isNodeJS ? process.domain : null,
			P.longStackSupport ? getTrace() : null
		);
	}

	function queueTask_( task, a, b, domain, trace ) {
		var node = tail.next;

		if ( node === head ) {
			node = new TaskNode();
			tail.next = node;
			node.next = head;
		} else {
			--nFreeTaskNodes;
		}

		tail = node;

		node.task = task;
		node.a = a;
		node.b = b;
		node.domain = domain;
		node.trace = trace;

		if ( !flushing ) {
			flushing = true;
			requestFlush();
		}
	}

	function requestFlushForNodeJS() {
		var currentDomain = process.domain;

		if ( currentDomain ) {
			if ( !domain ) domain = (1,require)("domain");
			domain.active = process.domain = null;
		}

		if ( flushing && hasSetImmediate ) {
			setImmediate( flush );

		} else {
			process.nextTick( flush );
		}

		if ( currentDomain ) {
			domain.active = process.domain = currentDomain;
		}
	}

	function makeRequestCallFromMutationObserver( callback ) {
		var toggle = 1;
		var node = document.createTextNode("");
		var observer = new gMutationObserver( callback );
		observer.observe( node, {characterData: true} );

		return function() {
			toggle = -toggle;
			node.data = toggle;
		};
	}

	function makeRequestCallFromTimer( callback ) {
		return function() {
			var timeoutHandle = setTimeout( handleTimer, 0 );
			var intervalHandle = setInterval( handleTimer, 50 );

			function handleTimer() {
				clearTimeout( timeoutHandle );
				clearInterval( intervalHandle );
				callback();
			}
		};
	}

	if ( isNodeJS ) {
		handleError = function( e ) {
			beforeThrow();
			throw e;
		};

	} else {
		handleError = function( e ) {
			pendingErrors.push( e );
			requestErrorThrow();
		}
	}

	function tryCall( toCall, onError ) {
		try {
			toCall.call();

		} catch ( e ) {
			onError( e );
		}
	}


	function asap( task ) {
		queueTask( tryCall, task, handleError );
	}

	//__________________________________________________________________________


	var PENDING = 0;
	var FULFILLED = 1;
	var REJECTED = 2;

	var OP_CALL = -1;
	var OP_THEN = -2;
	var OP_PROPAGATE = -3;
	var OP_MULTIPLE = -4;

	function ReportIfRejected( p ) {
		if ( p._state === REJECTED ) {
			queueTask_( reportError, p._value, handleError, p._domain, null );
		}
	}

	function reportError( error, onError ) {
		if ( P.onerror ) {
			try {
				(1,P.onerror)( error );

			} catch ( e ) {
				onError( e );
			}

		} else {
			onError( error );
		}
	}

	function P( x ) {
		return x instanceof Promise ?
			x :
			Resolve( new Promise(), x );
	}

	P.longStackSupport = false;

	function Fulfill( p, value ) {
		if ( p._state ) {
			return;
		}

		p._state = FULFILLED;
		p._value = value;

		if ( p._pending ) {
			HandlePending( p, p._op, p._pending );
			p._pending = null;
		}
	}

	function Reject( p, reason ) {
		if ( p._state ) {
			return;
		}

		if ( currentTrace ) {
			makeStackTraceLong( reason );
		}

		p._state = REJECTED;
		p._value = reason;

		if ( isNodeJS ) {
			p._domain = process.domain;
		}

		if ( p._pending ) {
			HandlePending( p, p._op, p._pending );
			p._pending = null;
		}
	}

	function Propagate( parent, p ) {
		if ( p._state ) {
			return;
		}

		p._state = parent._state;
		p._value = parent._value;
		p._domain = parent._domain;

		if ( p._pending ) {
			HandlePending( p, p._op, p._pending );
			p._pending = null;
		}
	}

	function Resolve( p, x ) {
		if ( p._state ) {
			return p;
		}

		if ( x instanceof Promise ) {
			if ( x === p ) {
				Reject( p, new TypeError("You can't resolve a promise with itself") );

			} else if ( x._state ) {
				Propagate( x, p );

			} else {
				OnSettled( x, OP_PROPAGATE, p );
			}

		} else if ( x !== Object(x) ) {
			Fulfill( p, x );

		} else {
			var then = GetThen( p, x );

			if ( typeof then === "function" ) {
				TryResolver( resolverFor(p), then, x );

			} else {
				Fulfill( p, x );
			}
		}

		return p;
	}

	function GetThen( p, x ) {
		try {
			return x.then;

		} catch ( e ) {
			Reject( p, e );
			return null;
		}
	}

	function TryResolver( d, resolver, x ) {
		try {
			call.call( resolver, x, d.resolve, d.reject );

		} catch ( e ) {
			d.reject( e );
		}
	}

	function HandlePending( p, op, pending ) {
		switch ( op ) {
			case OP_CALL:
				pending( p );
				break;

			case OP_THEN:
				queueTask_(
					Then, p, pending,
					p._domain || pending._domain,
					pending._trace
				);
				break;

			case OP_PROPAGATE:
				queueTask_(
					Propagate, p, pending,
					null,
					null
				);
				break;

			case OP_MULTIPLE:
				for ( var i = 0, l = pending.length; i < l; i += 2 ) {
					HandlePending( p, pending[i], pending[i + 1] );
				}
				break;

			default:
				pending( p, op );
		}
	}

	function OnSettled( p, op, pending ) {
		if ( p._state ) {
			HandlePending( p, op, pending );

		} else if ( !p._pending ) {
			p._pending = pending;
			p._op = op;

		} else if ( p._op === OP_MULTIPLE ) {
			p._pending.push( op, pending );

		} else {
			p._pending = [ p._op, p._pending, op, pending ];
			p._op = OP_MULTIPLE;
		}
	}

	function Then( parent, p ) {
		var cb = parent._state === FULFILLED ? p._cb : p._eb;
		p._cb = null;
		p._eb = null;
		p._domain = null;
		p._trace = null;

		if ( cb === null ) {
			Propagate( parent, p );

		} else {
			HandleCallback( p, cb, parent._value );
		}
	}

	function HandleCallback( p, cb, value ) {
		var x;

		try {
			x = cb( value );

		} catch ( e ) {
			Reject( p, e );
			return;
		}

		Resolve( p, x );
	}

	function resolverFor( promise ) {
		var done = false;

		return {
			promise: promise,

			resolve: function( y ) {
				if ( !done ) {
					done = true;
					Resolve( promise, y );
				}
			},

			reject: function( reason ) {
				if ( !done ) {
					done = true;
					Reject( promise, reason );
				}
			}
		};
	}

	P.defer = defer;
	function defer() {
		return resolverFor( new Promise() );
	}

	P.reject = reject;
	function reject( reason ) {
		var promise = new Promise();
		Reject( promise, reason );
		return promise;
	}

	function Promise() {
		this._state = 0;
		this._value = void 0;
		this._domain = null;
		this._cb = null;
		this._eb = null;
		this._op = 0;
		this._pending = null;
		this._trace = null;
	}

	Promise.prototype.then = function( onFulfilled, onRejected ) {
		var promise = new Promise();

		promise._cb = typeof onFulfilled === "function" ? onFulfilled : null;
		promise._eb = typeof onRejected === "function" ? onRejected : null;

		if ( P.longStackSupport ) {
			promise._trace = getTrace();
		}

		if ( isNodeJS ) {
			promise._domain = process.domain;
		}

		OnSettled( this, OP_THEN, promise );

		return promise;
	};

	Promise.prototype.done = function( cb, eb ) {
		var p = this;

		if ( cb || eb ) {
			p = p.then( cb, eb );
		}

		OnSettled( p, OP_CALL, ReportIfRejected );
	};

	Promise.prototype.fail = function( eb ) {
		return this.then( null, eb );
	};

	Promise.prototype.spread = function( cb, eb ) {
		return this.then( all ).then(function( args ) {
			return apply.call( cb, void 0, args );
		}, eb);
	};

	Promise.prototype.timeout = function( ms, msg ) {
		var promise = new Promise();

		if ( this._state !== PENDING ) {
			Propagate( this, promise );

		} else {
			var trace = P.longStackSupport ? getTrace() : null;
			var timeoutId = setTimeout(function() {
				currentTrace = trace;
				Reject( promise, new Error(msg || "Timed out after " + ms + " ms") );
			}, ms);

			OnSettled( this, OP_CALL, function( p ) {
				clearTimeout( timeoutId );
				Propagate( p, promise );
			});
		}

		return promise;
	};

	Promise.prototype.delay = function( ms ) {
		var d = defer();

		this.then(function( value ) {
			var trace = currentTrace;
			setTimeout(function() {
				currentTrace = trace;
				d.resolve( value );
			}, ms);
		}, d.reject);

		return d.promise;
	};

	Promise.prototype.all = function() {
		return this.then( all );
	};

	Promise.prototype.allSettled = function() {
		return this.then( allSettled );
	};

	Promise.prototype.inspect = function() {
		switch ( this._state ) {
			case PENDING:   return { state: "pending" };
			case FULFILLED: return { state: "fulfilled", value: this._value };
			case REJECTED:  return { state: "rejected", reason: this._value };
			default: throw new TypeError("invalid state");
		}
	};

	Promise.prototype.nodeify = function( nodeback ) {
		if ( nodeback ) {
			this.done(function( value ) {
				nodeback( null, value );
			}, nodeback);
			return void 0;

		} else {
			return this;
		}
	};

	P.allSettled = allSettled;
	function allSettled( input ) {
		var promise = new Promise();
		var len = input.length;

		if ( typeof len !== "number" ) {
			Reject( promise, new TypeError("input not array-like") );
			return promise;
		}

		var waiting = 0;
		var output = new Array( len );

		function onSettled( p, i ) {
			output[ i ] = p.inspect();
			if ( --waiting === 0 ) {
				Fulfill( promise, output );
			}
		}

		for ( var i = 0; i < len; ++i ) {
			if ( i in input ) {
				var p = P( input[i] );
				if ( p._state ) {
					output[ i ] = p.inspect();

				} else {
					++waiting;
					OnSettled( p, i, onSettled );
				}
			}
		}

		if ( waiting === 0 ) {
			Fulfill( promise, output );
		}

		return promise;
	}

	P.all = all;
	function all( input ) {
		var promise = new Promise();
		var len = input.length;

		if ( typeof len !== "number" ) {
			Reject( promise, new TypeError("input not array-like") );
			return promise;
		}

		var waiting = 0;
		var output = new Array( len );

		function onSettled( p, i ) {
			if ( p._state === REJECTED ) {
				Propagate( p, promise );
				return;
			}
			output[ i ] = p._value;
			if ( --waiting === 0 ) {
				Fulfill( promise, output );
			}
		}

		for ( var i = 0; i < len; ++i ) {
			if ( i in input ) {
				var p = P( input[i] );
				if ( p._state === FULFILLED ) {
					output[ i ] = p._value;

				} else if ( p._state === REJECTED ) {
					Propagate( p, promise );
					break;

				} else {
					++waiting;
					OnSettled( p, i, onSettled );
				}
			}
		}

		if ( waiting === 0 ) {
			Fulfill( promise, output );
		}

		return promise;
	}

	P.spread = spread;
	function spread( value, cb, eb ) {
		return all( value ).then(function( args ) {
			return apply.call( cb, void 0, args );
		}, eb);
	}

	P.promised = promised;
	function promised( f ) {
		function onFulfilled( thisAndArgs ) {
			return call.apply( f, thisAndArgs );
		}

		return function() {
			var len = arguments.length;
			var thisAndArgs = new Array( len + 1 );
			thisAndArgs[0] = this;
			for ( var i = 0; i < len; ++i ) {
				thisAndArgs[ i + 1 ] = arguments[ i ];
			}
			return all( thisAndArgs ).then( onFulfilled );
		};
	}

	P.onerror = null;

	P.nextTick = asap;

	var pEndingLine = captureLine();

	return P;
});
