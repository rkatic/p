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

	var withStack = withStackThrowing,
		pStartingLine = captureLine(),
		pFileName,
		currentTrace = null;

	function withStackThrowing( error ) {
		if ( !error.stack ) {
			try {
				throw error;
			} catch ( e ) {}
		}
		return error;
	}

	if ( new Error().stack ) {
		withStack = function( error ) {
			return error;
		};
	}

	function getTrace() {
		var stack = withStack( new Error() ).stack;
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
			/at .+ \((.+):(\d+):(?:\d+)\)$/.exec( stackLine ) ||
			/at ([^ ]+):(\d+):(?:\d+)$/.exec( stackLine ) ||
			/@(.+):(\d+):(?:\d+)$/.exec( stackLine );

		return m ? { fileName: m[1], lineNumber: Number(m[2]) } : null;
	}

	function captureLine() {
		var stack = withStack( new Error() ).stack;
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
		if ( error instanceof Error ) {
			var stack = error.stack;

			if ( !stack ) {
				stack = withStack( error ).stack;

			} else if ( ~stack.indexOf(STACK_JUMP_SEPARATOR) ) {
				return;
			}

			if ( stack ) {
				error.stack = [ filterStackString( stack, 0 ) ]
					.concat( currentTrace || [] )
					.join(STACK_JUMP_SEPARATOR);
			}
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
		this.a = null;
		this.b = null;
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

			var a = h.a;
			var b = h.b;
			h.a = null;
			h.b = null;

			Then( a, b );
		}

		flushing = false;
		currentTrace = null;
	}

	function scheduleThen( a, b ) {
		var node = tail.next;

		if ( node === head ) {
			tail.next = node = new TaskNode();
			node.next = head;
		} else {
			--nFreeTaskNodes;
		}

		tail = node;

		node.a = a;
		node.b = b;

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
			currentTrace = null;
			requestFlush();
			throw e;
		};

	} else {
		handleError = function( e ) {
			pendingErrors.push( e );
			requestErrorThrow();
		}
	}

	//__________________________________________________________________________


	var PENDING = 0;
	var FULFILLED = 1;
	var REJECTED = 2;

	var OP_CALL = 0;
	var OP_THEN = -1;
	var OP_MULTIPLE = -2;

	var VOID = P(void 0);

	function DoneEb( e ) {
		if ( P.onerror ) {
			(1,P.onerror)( e );

		} else {
			throw e;
		}
	}

	function ReportIfRejected( p ) {
		if ( p._state === REJECTED ) {
			if ( p._domain ) {
				p._domain.enter();
			}

			handleError( p._value );
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

		HandleSettled( p );
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

		HandleSettled( p );
	}

	function Propagate( parent, p ) {
		if ( p._state ) {
			return;
		}

		p._state = parent._state;
		p._value = parent._value;
		p._domain = parent._domain;

		HandleSettled( p );
	}

	function Resolve( p, x ) {
		if ( p._state ) {
			return p;
		}

		if ( x instanceof Promise ) {
			ResolveWithPromise( p, x );

		} else {
			var type = typeof x;

			if ( type === "object" && x !== null || type === "function" ) {
				ResolveWithObject( p, x )

			} else {
				Fulfill( p, x );
			}
		}

		return p;
	}

	function ResolveWithPromise( p, x ) {
		if ( x === p ) {
			Reject( p, new TypeError("You can't resolve a promise with itself") );

		} else if ( x._state ) {
			Propagate( x, p );

		} else {
			OnSettled( x, OP_THEN, p );
		}
	}

	function ResolveWithObject( p, x ) {
		var then = GetThen( p, x );

		if ( typeof then === "function" ) {
			TryResolver( resolverFor(p, false), then, x );

		} else {
			Fulfill( p, x );
		}
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

	function HandleSettled( p ) {
		if ( p._pending ) {
			HandlePending( p, p._op, p._pending );
			p._pending = null;
		}
	}

	function HandlePending( p, op, pending ) {
		if ( op >= 0 ) {
			pending( p, op );

		} else if ( op === OP_THEN ) {
			scheduleThen( p, pending );

		} else {
			for ( var i = 0, l = pending.length; i < l; i += 2 ) {
				HandlePending( p, pending[i], pending[i + 1] );
			}
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
		var domain = parent._domain || p._domain;

		currentTrace = p._trace;

		var cb = parent._state === FULFILLED ? p._cb : p._eb;

		p._cb = null;
		p._eb = null;
		p._domain = null;
		p._trace = null;

		if ( cb === null ) {
			Propagate( parent, p );

		} else if ( domain ) {
			if ( !domain._disposed ) {
				domain.enter();
				HandleCallback( p, cb, parent._value );
				domain.exit();
			}

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

	function resolverFor( promise, nodelike ) {
		var done = false;
		var trace = P.longStackSupport ? getTrace() : null;

		function resolve( error, y ) {
			if ( !done ) {
				done = true;

				if ( trace ) {
					if ( currentTrace ) {
						trace = null;

					} else {
						currentTrace = trace;
					}
				}

				if ( error ) {
					Reject( promise, nodelike ? error : y );

				} else {
					Resolve( promise, y );
				}

				if ( trace ) {
					currentTrace = null;
				}
			}
		}

		return nodelike ? resolve : {
			promise: promise,

			resolve: function( y ) {
				resolve( false, y );
			},

			reject: function( reason ) {
				resolve( true, reason );
			}
		};
	}

	P.defer = defer;
	function defer() {
		return resolverFor( new Promise(), false );
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

	Promise.prototype._clone = function() {
		var promise = new Promise();
		ResolveWithPromise( promise, this );
		return promise;
	};

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

		if ( this._state ) {
			scheduleThen( this, promise );

		} else {
			OnSettled( this, OP_THEN, promise );
		}

		return promise;
	};

	Promise.prototype.done = function( cb, eb ) {
		var p = this;

		if ( cb || eb ) {
			p = p.then( cb, eb );
		}

		p = p.then( null, DoneEb );

		OnSettled( p, OP_CALL, ReportIfRejected );
	};

	Promise.prototype.fail = function( eb ) {
		return this.then( null, eb );
	};

	Promise.prototype.fin = function( cb ) {
		var p = this;
		var promise = p.then( _finally, _finally );

		function _finally() {
			return P( cb() ).then(function() {
				Propagate( p, promise );
			});
		}

		return promise;
	};

	Promise.prototype.spread = function( cb, eb ) {
		return this.then( _all ).then(function( args ) {
			return apply.call( cb, void 0, args );
		}, eb);
	};

	Promise.prototype.timeout = function( ms, msg ) {
		var promise = this._clone();

		if ( this._state === PENDING ) {
			var trace = P.longStackSupport ? getTrace() : null;
			var timeoutId = setTimeout(function() {
				currentTrace = trace;
				Reject( promise, new Error(msg || "Timed out after " + ms + " ms") );
				currentTrace = null;
			}, ms);

			OnSettled( this, OP_CALL, function() {
				clearTimeout( timeoutId );
			});
		}

		return promise;
	};

	Promise.prototype.delay = function( ms ) {
		var promise = new Promise();

		OnSettled(this, OP_CALL, function( p ) {
			if ( p._state === FULFILLED ) {
				setTimeout(function() {
					Propagate( p, promise );
				}, ms);

			} else {
				VOID.then(function() {
					Propagate( p, promise );
				});
			}
		});

		return promise;
	};

	Promise.prototype.all = function() {
		return this.then( _all );
	};

	Promise.prototype.allSettled = function() {
		return this.then( _allSettled );
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
		var promise = _allSettled( input );
		// Ensure propagation doesn't overflew the stack.
		return promise._state ? promise : promise._clone();
	}

	function _allSettled( input ) {
		var promise = new Promise();
		var len = input.length;

		if ( typeof len !== "number" ) {
			Reject( promise, new TypeError("input not array-like") );
			return promise;
		}

		var output = new Array( len );
		var waiting = len;

		function onSettled( p, i ) {
			output[ i ] = p.inspect();
			if ( --waiting === 0 ) {
				Fulfill( promise, output );
			}
		}

		for ( var i = 0; i < len; ++i ) {
			OnSettled( P(input[i]), i, onSettled );
		}

		if ( waiting === 0 ) {
			Fulfill( promise, output );
		}

		return promise;
	}

	P.all = all;
	function all( input ) {
		var promise = _all( input );
		// Ensure propagation doesn't overflew the stack.
		return promise._state ? promise : promise._clone();
	}

	function _all( input ) {
		var promise = new Promise();
		var len = input.length;

		if ( typeof len !== "number" ) {
			Reject( promise, new TypeError("input not array-like") );
			return promise;
		}

		var output = new Array( len );
		var waiting = len;

		function onSettled( p, i ) {
			if ( output !== null ) {
				if ( p._state === REJECTED ) {
					output = null;
					Propagate( p, promise );

				} else {
					output[ i ] = p._value;
					if ( --waiting === 0 ) {
						Fulfill( promise, output );
					}
				}
			}
		}

		for ( var i = 0; i < len; ++i ) {
			OnSettled( P(input[i]), i, onSettled );
		}

		if ( waiting === 0 ) {
			Fulfill( promise, output );
		}

		return promise;
	}

	P.spread = spread;
	function spread( values, cb, eb ) {
		return _all( values ).then(function( args ) {
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
			return _all( thisAndArgs ).then( onFulfilled );
		};
	}

	P.denodeify = denodeify;
	function denodeify( f ) {
		return function() {
			var promise = new Promise();

			var i = arguments.length;
			var args = new Array( i + 1 );
			args[i] = resolverFor( promise, true );
			while ( i-- ) {
				args[i] = arguments[i];
			}

			TryApply( promise, f, this, args );

			return promise;
		};
	}

	function TryApply( p, f, that, args ) {
		try {
			apply.call( f, that, args );

		} catch ( e ) {
			Reject( p, e );
		}
	}

	P.onerror = null;

	P.nextTick = function nextTick( task ) {
		// We don't use .done to avoid P.onerror.
		var p = VOID.then(function() {
			task.call();
		});
		OnSettled( p, OP_CALL, ReportIfRejected );
	};

	var pEndingLine = captureLine();

	return P;
});
