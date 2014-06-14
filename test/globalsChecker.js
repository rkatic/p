var globalsChecker = {
	s0: Object.keys(self),
	init: function() {
		this.s0 = Object.keys(self);
	},
	check: function() {
		var s0 = this.s0;
		var s1 = Object.keys(self);

		return s1.filter(function(x) {
			return s0.indexOf(x) === -1;
		});
	}
};
