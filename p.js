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

	function getFileNameAndLineNumber( stackLine ) {
		var m =
			/at .+ \((.+):(\d+):(?:\d+)\)$/.exec( stackLine ) ||
			/at ([^ ]+):(\d+):(?:\d+)$/.exec( stackLine ) ||
			/.*@(.+):(\d+)$/.exec( stackLine );

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
			var stacks = [ filterStackString( error.stack, 0 ) ];

			var trace = currentTrace;
			while ( trace ) {
				var stack = trace.stack && filterStackString( trace.stack, 2 );
				if ( stack ) {
					stacks.push( stack );
				}
				trace = trace.parent;
			}

			var longStack = stacks.join(STACK_JUMP_SEPARATOR);
			error.stack = longStack;
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
		this.domain = null;
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
			head = head.next;
			var task = head.task;

			if ( nFreeTaskNodes >= 1024 ) {
				tail.next = tail.next.next;
			} else {
				++nFreeTaskNodes;
			}

			if ( head.domain ) {
				runInDomain( head.domain, task, head.a, head.b, void 0 );
				head.domain = null;

			} else {
				task( head.a, head.b );
			}

			head.task = null;
			head.a = null;
			head.b = null;
		}

		flushing = false;
	}

	function beforeThrow() {
		head.task = null;
		head.domain = null;
		head.a = null;
		head.b = null;
		requestFlush();
	}

	function runInDomain( domain, task, a, b, c ) {
		if ( domain._disposed ) {
			return;
		}
		domain.enter();
		task( a, b, c );
		domain.exit();
	}

	function queueTask( setDomain, task, a, b ) {
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

		if ( setDomain && isNodeJS ) {
			node.domain = process.domain;
		}

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
		queueTask( true, tryCall, task, handleError );
	}

	//__________________________________________________________________________


	function forEach( arr, cb ) {
		for ( var i = 0, l = arr.length; i < l; ++i ) {
			if ( i in arr ) {
				cb( arr[i], i );
			}
		}
	}

	function reportError( error ) {
		asap(function() {
			if ( P.onerror ) {
				P.onerror.call( null, error );

			} else {
				throw error;
			}
		});
	}

	var PENDING = 0;
	var FULFILLED = 1;
	var REJECTED = 2;

	function P( x ) {
		return x instanceof Promise ?
			x :
			Resolve( new Promise(), x, false );
	}

	P.longStackSupport = false;

	function Fulfill( p, value ) {
		if ( p._state ) {
			return;
		}

		p._state = FULFILLED;
		p._value = value;

		if ( p._pending ) {
			EnqueuePending( p );
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
			EnqueuePending( p );
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
			EnqueuePending( p );
		}
	}

	function Resolve( p, x, sync ) {
		if ( p._state ) {
			return p;
		}

		if ( x instanceof Promise ) {
			if ( x === p ) {
				Reject( p, new TypeError("You can't resolve a promise with itself") );

			} else if ( x._state ) {
				Propagate( x, p );

			} else {
				Follow( p, x );
			}

		} else if ( x !== Object(x) ) {
			Fulfill( p, x );

		} else if ( sync ) {
			Assimilate( p, x );

		} else {
			queueTask( true, Assimilate, p, x );
		}

		return p;
	}

	function Assimilate( p, x ) {
		var r, then;

		try {
			then = x.then;

		} catch ( e1 ) {
			Reject( p, e1 );
			return;
		}

		if ( typeof then === "function" ) {
			r = resolverFor( p );

			try {
				call.call( then, x, r.resolve, r.reject );

			} catch ( e2 ) {
				r.reject( e2 );
			}

		} else {
			Fulfill( p, x );
		}
	}

	function EnqueuePending( p ) {
		var pending = p._pending;
		p._pending = null;

		if ( pending instanceof Promise ) {
			queueTask( false, Then, p, pending );
			return;
		}

		for ( var i = 0, l = pending.length; i < l; ++i ) {
			queueTask( false, Then, p, pending[i] );
		}
	}

	function Follow( child, p ) {
		if ( !p._pending ) {
			p._pending = child;

		} else if ( p._pending instanceof Promise ) {
			p._pending = [ p._pending, child ];

		} else {
			p._pending.push( child );
		}
	}

	function Then( parent, child ) {
		var cb = parent._state === FULFILLED ? child._cb : child._eb;
		child._cb = null;
		child._eb = null;

		if ( !cb ) {
			Propagate( parent, child );
			return;
		}

		var trace = child._trace;
		if ( trace ) {
			var prevTrace = currentTrace;
			currentTrace = trace;
		}

		var domain = parent._domain || child._domain;

		if ( domain ) {
			child._domain = null;
			runInDomain( domain, HandleCallback, cb, child, parent._value );

		} else {
			HandleCallback( cb, child, parent._value );
		}

		if ( trace ) {
			currentTrace = prevTrace;
		}
	}

	function HandleCallback( cb, promise, value ) {
		var x;

		try {
			x = cb( value );

		} catch ( e ) {
			Reject( promise, e );
			return;
		}

		Resolve( promise, x, true );
	}

	function resolverFor( promise ) {
		var done = false;

		return {
			promise: promise,

			resolve: function( y ) {
				if ( !done ) {
					done = true;
					Resolve( promise, y, false );
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
		this._pending = null;
		this._trace = null;
	}

	Promise.prototype.then = function( onFulfilled, onRejected ) {
		var promise = new Promise();

		if ( P.longStackSupport ) {
			promise._trace = {
				parent: currentTrace,
				stack: new Error().stack
			};
		}

		promise._cb = typeof onFulfilled === "function" ? onFulfilled : null;
		promise._eb = typeof onRejected === "function" ? onRejected : null;

		promise._domain = isNodeJS ? process.domain : null;

		if ( this._state === PENDING ) {
			Follow( promise, this );

		} else {
			queueTask( false, Then, this, promise );
		}

		return promise;
	};

	Promise.prototype.done = function( cb, eb ) {
		var p = this;

		if ( cb || eb ) {
			p = p.then( cb, eb );
		}

		p.then( null, reportError );
	};

	Promise.prototype.fail = function( eb ) {
		return this.then( null, eb );
	};

	Promise.prototype._always = function( cb ) {
		return this.then( cb, cb );
	};

	Promise.prototype.spread = function( cb, eb ) {
		return this.then(cb && function( array ) {
			return all( array ).then(function( values ) {
				return apply.call( cb, void 0, values );
			}, eb);
		}, eb);
	};

	Promise.prototype.timeout = function( ms, msg ) {
		var p = this;
		var p2 = new Promise();

		if ( p._state !== PENDING ) {
			Propagate( p, p2 );

		} else {
			var timeoutId = setTimeout(function() {
				Reject( p2, new Error(msg || "Timed out after " + ms + " ms") );
			}, ms);

			p._always(function() {
				clearTimeout( timeoutId );
				Propagate( p, p2 );
			});
		}

		return p2;
	};

	Promise.prototype.delay = function( ms ) {
		var d = defer();

		this.then(function( value ) {
			setTimeout(function() {
				d.resolve( value );
			}, ms);
		}, d.reject);

		return d.promise;
	};

	Promise.prototype.inspect = function() {
		switch ( this._state ) {
			case PENDING:   return { state: "pending" };
			case FULFILLED: return { state: "fulfilled", value: this._value };
			case REJECTED:  return { state: "rejected", reason: this._value };
			default: throw new TypeError("invalid state");
		}
	};

	P.allSettled = allSettled;
	function allSettled( input ) {
		var waiting = 0;
		var promise = new Promise();
		var output = new Array( input.length );

		forEach( input, function( x, index ) {
			var p = P( x );
			if ( p._state === PENDING ) {
				++waiting;
				p._always(function() {
					output[ index ] = p.inspect();
					if ( --waiting === 0 ) {
						Fulfill( promise, output );
					}
				});

			} else {
				output[ index ] = p.inspect();
			}
		});

		if ( waiting === 0 ) {
			Fulfill( promise, output );
		}

		return promise;
	}

	P.all = all;
	function all( input ) {
		var waiting = 0;
		var d = defer();
		var output = new Array( input.length );

		forEach( input, function( x, index ) {
			var p = P( x );
			if ( p._state === FULFILLED ) {
				output[ index ] = p._value;

			} else {
				++waiting;
				p.then(function( value ) {
					output[ index ] = value;
					if ( --waiting === 0 ) {
						d.resolve( output );
					}
				}, d.reject);
			}
		});

		if ( waiting === 0 ) {
			d.resolve( output );
		}

		return d.promise;
	}

	P.promised = promised;
	function promised( f ) {
		function onFulfilled( thisAndArgs ) {
			return apply.apply( f, thisAndArgs );
		}

		return function() {
			return all([ this, all(arguments) ]).then( onFulfilled );
		};
	}

	P.onerror = null;

	P.nextTick = asap;

	var pEndingLine = captureLine();

	return P;
});
