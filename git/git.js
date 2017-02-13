var path = require('path');
var nodegit = require('nodegit');
var promisify = require('es6-promisify');
var fs = require('fs-extra');

var ensureDir = promisify(fs.mkdirs);

var index;
var parents = [];

var addAndCommit = function (repo, user, msg) {
	return repo.refreshIndex()
    .then(function (idx) {
	index = idx;
}).then(function () {
      // the entire directory is always managed by software so we can safely
      // always add everything
	return index.addAll();
})
    .then(function () {
	return index.write();
})
    .then(function () {
	return index.writeTree();
})
    .then(function (oid) {
	var sig = nodegit.Signature.now(user.username, user.email);

      // Since we're creating an inital commit, it has no parents. Note that unlike
      // normal we don't get the head either, because there isn't one yet.
	return repo.createCommit('HEAD', sig, sig, msg, oid, parents);
})
    .then(function (commitId) {
	return commitId;
});
};

var repo;

module.exports = {
  // opens the repo, gets the HEAD commit
	commit: function (dir, user, msg) {
		return nodegit.Repository.open(path.resolve(dir, '.git'))
    .then(function (repoResult) {
	repo = repoResult;
	return nodegit.Reference.nameToId(repo, 'HEAD');
}).then(function (head) {
	return repo.getCommit(head);
}).then(function (parent) {
	parents = [parent];
	return addAndCommit(repo, user, msg);
});
	},

	createRepo: async function (dir, user, msg) {
    // creates the directory, initializes the repo
		parents = [];
		return ensureDir(dir)
    .then(function () {
	return nodegit.Repository.init(dir, 0);
})
    .then(function (repo) {
	return addAndCommit(repo, user, msg);
}).catch(function (err) {
	console.log('error creating repo:', err);
});
	}
};
