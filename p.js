/*!
 * Copyright 2013 Robert Katić
 * Released under the MIT license
 * https://github.com/rkatic/p/blob/master/LICENSE
 *
 * High-priority-tasks code-portion based on https://github.com/kriskowal/asap
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

		requestFlush =
			isNodeJS ? requestFlushForNodeJS :
			gMutationObserver ? makeRequestCallFromMutationObserver( flush ) :
			makeRequestCallFromTimer( flush ),

		pendingErrors = [],
		requestErrorThrow = makeRequestCallFromTimer( throwFirstError ),

		asapRunSafe,

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

			if ( head.domain ) {
				runInDomain( head.domain, task, head.a, head.b );
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

	function queueNodes( first, last ) {
		var t = tail.next;
		tail.next = first;
		tail = last || first;
		tail.next = t;

		if ( !flushing ) {
			flushing = true;
			requestFlush();
		}
	}

	function beforeThrow() {
		head.task = null;
		head.domain = null;
		head.a = null;
		head.b = null;
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

	function createTaskNode( p, setDomain, task, a, b ) {
		var node = tail.next;

		if ( node === head ) {
			node = new TaskNode();
			if ( !p ) {
				tail = tail.next = node;
				node.next = head;
			}

		} else if ( p ) {
			tail.next = node.next;
			node.next = null;

		} else {
			tail = node;
		}

		node.task = task;
		node.a = a;
		node.b = b;

		if ( setDomain && isNodeJS ) {
			node.domain = process.domain;
		}

		if ( p ) {
			if ( p._lastPending ) {
				p._lastPending.next = node;
			} else {
				p._firstPending = node;
			}
			p._lastPending = node;

		} else if ( !flushing ) {
			flushing = true;
			requestFlush();
		}

		return node;
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
		asapRunSafe = function( task ) {
			try {
				task.call();

			} catch ( e ) {
				beforeThrow();
				throw e;
			}
		};

	} else {
		asapRunSafe = function( task ) {
			try {
				task.call();

			} catch ( e ) {
				pendingErrors.push( e );
				requestErrorThrow();
			}
		}
	}


	function asap( task ) {
		createTaskNode( null, true, asapRunSafe, task, void 0 );
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
			Resolve( new Promise(), x );
	}

	function Settle( p, state, value ) {
		if ( p._state ) {
			return p;
		}

		p._state = state;
		p._value = value;

		if ( state === REJECTED && !p._domain && isNodeJS ) {
			p._domain = process.domain;
		}

		if ( p._firstPending ) {
			queueNodes( p._firstPending, p._lastPending );
			p._firstPending = null;
			p._lastPending = null;
		}

		return p;
	}

	function Propagate( p, child ) {
		child._domain = p._domain;
		Settle( child, p._state, p._value );
	}

	function Resolve( p, x, sync ) {
		if ( p._state ) {
			return p;
		}

		if ( x instanceof Promise ) {
			if ( x === p ) {
				Settle( p, REJECTED, new TypeError("You can't resolve a promise with itself") );

			} else if ( x._state ) {
				Propagate( x, p );

			} else {
				createTaskNode( x, false, Propagate, x, p );
			}

		} else if ( x !== Object(x) ) {
			Settle( p, FULFILLED, x );

		} else if ( sync ) {
			Assimilate( p, x );

		} else {
			createTaskNode( null, true, Assimilate, p, x );
		}

		return p;
	}

	function Assimilate( p, x ) {
		var r, then;

		try {
			then = x.then;

		} catch ( e1 ) {
			Settle( p, REJECTED, e1 );
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
			Settle( p, FULFILLED, x );
		}
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
					Settle( promise, REJECTED, reason );
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
		return Settle( new Promise(), REJECTED, reason );
	}

	function Promise() {
		this._state = 0;
		this._value = void 0;
		this._domain = null;
		this._cb = null;
		this._eb = null;
		this._firstPending = null;
		this._lastPending = null;
	}

	Promise.prototype.then = function( onFulfilled, onRejected ) {
		var promise = new Promise();

		promise._cb = typeof onFulfilled === "function" ? onFulfilled : null;
		promise._eb = typeof onRejected === "function" ? onRejected : null;

		promise._domain = isNodeJS ? process.domain : null;

		createTaskNode(
			this._state === PENDING ? this : null,
			false, // no domain binding
			Then,
			this, // parent
			promise // child
		);

		return promise;
	};

	function Then( parent, child ) {
		var cb = parent._state === FULFILLED ? child._cb : child._eb;
		child._cb = null;
		child._eb = null;

		if ( !cb ) {
			Propagate( parent, child );
			return;
		}

		child._value = parent._value;

		var domain = parent._domain || child._domain;

		if ( domain ) {
			child._domain = null;
			runInDomain( domain, HandleCallback, cb, child );

		} else {
			HandleCallback( cb, child );
		}
	}

	function HandleCallback( cb, promise ) {
		var x;

		try {
			x = cb( promise._value );

		} catch ( e ) {
			Settle( promise, REJECTED, e );
			return;
		}

		Resolve( promise, x, true );
	}

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

	Promise.prototype.spread = function( cb, eb ) {
		return this.then(cb && function( array ) {
			return all( array, [] ).then(function( values ) {
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
				Settle( p2, REJECTED,
					new Error(msg || "Timed out after " + ms + " ms") );
			}, ms);

			createTaskNode(p, false, function() {
				clearTimeout( timeoutId );
				Propagate( p, p2 );
			}, void 0, void 0);
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

		function onSettled( p, index ) {
			output[ index ] = p.inspect();
			if ( --waiting === 0 ) {
				Settle( promise, FULFILLED, output );
			}
		}

		for ( var i = 0; l = input.length; ++i ) {
			var p = P( x );
			if ( p._state === PENDING ) {
				++waiting;
				createTaskNode( p, false, onSettled, p, i );
			} else {
				output[ index ] = p.inspect();
			}
		}

		if ( waiting === 0 ) {
			Settle( promise, FULFILLED, output );
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

	return P;
});
