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
		isNodeJS = ot(typeof process) &&
			({}).toString.call(process) === "[object process]",

		hasSetImmediate = ot(typeof setImmediate),

		head = { f: null, n: null }, tail = head,
		flushing = false,

		requestFlush =
			isNodeJS && requestFlushForNodeJS ||
			makeRequestCallFromMutationObserver( flush ) ||
			makeRequestCallFromTimer( flush ),

		pendingErrors = [],
		requestErrorThrow = makeRequestCallFromTimer( throwFristError ),

		wrapTask,
		asapSafeTask,

		domain,

		call = ot.call,
		apply = ot.apply;

	function ot( type ) {
		return type === "object" || type === "function";
	}

	function throwFristError() {
		if ( pendingErrors.length ) {
			throw pendingErrors.shift();
		}
	}

	function flush() {
		while ( head.n ) {
			head = head.n;
			var f = head.f;
			head.f = null;
			f.call();
		}
		flushing = false;
	}

	var runLater = function( f ) {
		tail = tail.n = { f: f, n: null };
		if ( !flushing ) {
			flushing = true;
			requestFlush();
		}
	};

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
		var observer =
			ot(typeof MutationObserver) ? new MutationObserver( callback ) :
			ot(typeof WebKitMutationObserver) ? new WebKitMutationObserver( callback ) :
			null;

		if ( !observer ) {
			return null;
		}

		var toggle = 1;
		var node = document.createTextNode("");
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
		wrapTask = function( task ) {
			var d = process.domain;

			return function() {
				if ( d ) {
					if ( d._disposed ) return;
					d.enter();
				}

				try {
					task.call();

				} catch ( e ) {
					requestFlush();
					throw e;
				}

				if ( d ) {
					d.exit();
				}
			};
		};

		asapSafeTask = function( task ) {
			var d = process.domain;
			runLater(!d ? task : function() {
				if ( !d._disposed ) {
					d.enter();
					task.call();
					d.exit();
				}
			});
		}

	} else {
		wrapTask = function( task ) {
			return function() {
				try {
					task.call();

				} catch ( e ) {
					pendingErrors.push( e );
					requestErrorThrow();
				}
			};
		}

		asapSafeTask = runLater;
	}


	function asap( task ) {
		runLater( wrapTask(task) );
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

	function Settle( p, state, value, domain ) {
		if ( p._state ) {
			return p;
		}

		p._state = state;
		p._value = value;

		if ( domain ) {
			p._domain = domain;

		} else if ( isNodeJS && state === REJECTED ) {
			p._domain = process.domain;
		}

		if ( p._pending.length ) {
			forEach( p._pending, runLater );
		}
		p._pending = null;

		return p;
	}

	function OnSettled( p, f ) {
		p._pending.push( f );
	}

	function Propagate( p, p2 ) {
		Settle( p2, p._state, p._value, p._domain );
	}

	function Resolve( p, x ) {
		if ( p._state ) {
			return p;
		}

		if ( x instanceof Promise ) {
			if ( x === p ) {
				Settle( p, REJECTED, new TypeError("You can't resolve a promise with itself") );

			} else if ( x._state ) {
				Propagate( x, p );

			} else {
				OnSettled(x, function() {
					Propagate( x, p );
				});
			}

		} else if ( x !== Object(x) ) {
			Settle( p, FULFILLED, x );

		} else {
			asapSafeTask(function() {
				var r = resolverFor( p );

				try {
					var then = x.then;

					if ( typeof then === "function" ) {
						call.call( then, x, r.resolve, r.reject );

					} else {
						Settle( p, FULFILLED, x );
					}

				} catch ( e ) {
					r.reject( e );
				}
			});
		}

		return p;
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
		this._pending = [];
	}

	Promise.prototype.then = function( onFulfilled, onRejected ) {
		var cb = typeof onFulfilled === "function" ? onFulfilled : null;
		var eb = typeof onRejected === "function" ? onRejected : null;

		var p = this;
		var p2 = new Promise();

		var thenDomain = isNodeJS && process.domain;

		function onSettled() {
			var func = p._state === FULFILLED ? cb : eb;
			if ( !func ) {
				Propagate( p, p2 );
				return;
			}

			var x, catched = false;
			var d = p._domain || thenDomain;

			if ( d ) {
				if ( d._disposed ) return;
				d.enter();
			}

			try {
				x = func( p._value );

			} catch ( e ) {
				catched = true;
				Settle( p2, REJECTED, e );
			}

			if ( !catched ) {
				Resolve( p2, x );
			}

			if ( d ) {
				d.exit();
			}
		}

		if ( p._state === PENDING ) {
			OnSettled( p, onSettled );

		} else {
			runLater( onSettled );
		}

		return p2;
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

			OnSettled(p, function() {
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

	function valuesHandler( f ) {
		function onFulfilled( values ) {
			return f( values, [] );
		}

		function handleValues( values ) {
			return P( values ).then( onFulfilled );
		}

		handleValues._ = f;
		return handleValues;
	}

	P.allSettled = valuesHandler( allSettled );
	function allSettled( input, output ) {
		var waiting = 0;
		var promise = new Promise();
		forEach( input, function( x, index ) {
			var p = P( x );
			if ( p._state === PENDING ) {
				++waiting;
				OnSettled(p, function() {
					output[ index ] = p.inspect();
					if ( --waiting === 0 ) {
						Settle( promise, FULFILLED, output );
					}
				});
			} else {
				output[ index ] = p.inspect();
			}
		});
		if ( waiting === 0 ) {
			Settle( promise, FULFILLED, output );
		}
		return promise;
	}

	P.all = valuesHandler( all );
	function all( input, output ) {
		var waiting = 0;
		var d = defer();
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
			var allArgs = all( arguments, [] );
			return all( [this, allArgs], [] ).then( onFulfilled );
		};
	}

	P.onerror = null;

	P.nextTick = asap;

	return P;
});
