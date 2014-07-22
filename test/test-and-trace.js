
var fs = require("fs");

if ( !global.TRACE_FUNCTIONS ) {
	global.TRACE_FUNCTIONS = {
		records: [],
		nextName: '',
		_enabled: true,
		stopAdding: function() {
			this._enabled = false;
		},
		set fn(fn) {
			if ( this._enabled ) {
				this.records.push({name: this.nextName||fn.name, fn: fn});
				//%OptimizeFunctionOnNextCall(fn);
			}
			this.nextName = '';
		},
		optimize: function() {
			this.records.forEach(function ( r ) {
				%OptimizeFunctionOnNextCall( r.fn );
			});
		}
	};
}

var silent = process.argv.slice(-1)[0] === '-';

buildTracable("./p.js", "./test/p.js");

runOwnTest(silent ? null : logStatuses);

function logStatuses() {
	TRACE_FUNCTIONS.records.forEach(function( r ) {
		console.log( r.name + ' : ' + getOptStatus(r.fn) + ' : ' + %GetOptimizationCount(r.fn) );
	});
}

function runOwnTest(cb) {
	var Mocha = require("mocha");

	var reporter = silent ? function(){} : "dot";

	var mocha = new Mocha({ reporter: reporter });
	mocha.addFile("./test/test.js");

	mocha.run(cb);
}

function buildTracable(srcname, dstname) {
	var src = fs.readFileSync(srcname, {encoding: "utf8"})
		.replace(/^[ \t]*(?:(\w+)\.prototype\.(\w+) *\= *function[ \(]|function +(\w+) *\()/mg,
			function(all, cls, prop, name) {
				return (cls ?
					'TRACE_FUNCTIONS.nextName = "' + cls+'::'+prop + '"; TRACE_FUNCTIONS.fn = ' :
					'TRACE_FUNCTIONS.fn = ' + name + '; '
				) + all;
			}
		);

	fs.writeFileSync(dstname, src);
}

function getOptStatus(fn) {
	switch (%GetOptimizationStatus(fn)) {
		case 1: return "optimized";
		case 2: return "not optimized";
		case 3: return "always optimized";
		case 4: return "never optimized";
		case 6: return "maybe deoptimized";
	}
}

//"--- AUTO GENERATED CONTENT ---" +
//"(" +
//	[d.getUTCFullYear(), d.getUTCMonth, d.getUTCDate()].join("/") +
//	" " + [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].join(":") +
//")\n" +

// node --trace_opt --trace_deopt --allow-natives-syntax test/test-and-trace.js - > out.txt

// node --trace-hydrogen --code-comments --trace-deopt --allow-natives-syntax test/test-and-trace.js - > out.txt
