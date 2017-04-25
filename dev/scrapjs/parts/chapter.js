'use strict';

var scrap = require("./scrap");
var path = require("path");
var ncp_cb = require('ncp').ncp;
var promisify = require("es6-promisify");
var ncp = promisify(ncp_cb);
const mkdirp = require('mkdirp');
const mkdirpp = promisify(mkdirp);
const lescape = require('escape-latex');
var stringify = require('json-stable-stringify');
var fs = require('fs-extra');
var ensureDir = promisify(fs.mkdirs);
var writeFile = promisify(fs.writeFile);
var readFile = promisify(fs.readFile);
const uuidV4 = require('uuid/v4');
var git = require("../git/git");

var reconstitute = async function (author, uuid, sha) {
  var data = {};
  if (sha !== null && sha !== undefined) {
    var dir = global.storage + author + '/chapter/' + uuid;
    dir = path.resolve(process.env.PWD, dir);
    data = JSON.parse(await git.getFileFromCommit(dir, 'info.json', sha));
  } else {
    data = JSON.parse(await readFile(global.storage + author + '/chapter/' + uuid + '/info.json', 'utf8'));
  }
  return new Chapter(data.name, data.author, data.uuid, data.scraps, data.oldAuthors);
}

var Chapter = function(chapterName, authorName, uuid, scraps, authors) {
  this.name = chapterName;
  this.author = authorName;
  this.oldAuthors = authors; // previous authors from before forking
  this.head = undefined;
  this.isNew = true;
  if (uuid === undefined) {
    this.uuid = uuidV4();
  } else {
    this.uuid = uuid;
  }
  if (scraps === undefined) {
    this.scraps = [];
  } else {
    this.scraps = scraps;
  }
}

Chapter.prototype.getText = async function() {
  var runningText = "\\end{plainraw}\n\\newpage\n\\section{" + lescape(this.name) + "}\n\\begin{plainraw}\n\n";
  let authors = [this.author];
  if (this.oldAuthors !== undefined) {
    authors = authors.concat(this.oldAuthors);
  }
  for (let s of this.scraps) {
    let ns = await scrap.reconstitute(s[0], s[1], s[2]);
    let [sText, sAuthor] = ns.getText();
    if (ns.latex) {
      runningText = runningText + "\n\\end{plainraw}\n" + sText + "\n\\begin{plainraw}\n";
    } else {
      runningText = runningText + sText + "\n\n";
    }

    authors.concat(sAuthor);
  }
  return [runningText, Array.from(new Set(authors))];
}

Chapter.prototype.addScrap = function(scrap, sha) {
  if (sha == undefined) {
    sha = scrap.head
  }
  this.scraps.push([scrap.author, scrap.uuid, sha]);
};

Chapter.prototype.removeScrap = function(scrap) {
  var index = this.scraps.indexOf(scrap);
  this.scraps.splice(index, 1);
};

Chapter.prototype.setScraps = function(scraps) {
  this.scraps = scraps;
};

Chapter.prototype.previousVersions = function(numVersions) {
  return git.getParents(global.storage + this.author + '/chapter/' + this.uuid);
  // return list of previous versions as a [[hash, commit message], ...]
}

Chapter.prototype.save = function(reason) {
  // save new version with commit message `reason`
  var u = {};
  u.email = "test@test.com";
  u.username = this.author;
  var commitMessage = reason;
  var dir = global.storage + u.username + '/chapter/' + this.uuid;

  var chapter = this;

  // TODO sane place to chapter chapters
  dir = path.resolve(process.env.PWD, dir)

  return ensureDir(dir)
  .then(function() {
    return writeFile(path.join(dir, "info.json"), stringify(chapter, {space: '  '}));
  }).then(function() {
    return git.createAndCommit(dir, u, commitMessage);
  });
}

Chapter.prototype.getBySha = async function(hash) {
  // get old version of chapter
  var dir = global.storage + this.author + '/chapter/' + this.uuid;
  dir = path.resolve(process.env.PWD, dir)
  return await git.getFileFromCommit(dir, 'info.json', hash);
}

Chapter.prototype.fork = async function(newUser) {
  // fork chapter to another user's directory
	await mkdirpp(global.storage + newUser + '/scrap/');
  var err = await ncp(global.storage + this.author + '/chapter/' + this.uuid, global.storage + newUser + '/chapter/' + this.uuid);
  var newChap = await reconstitute(newUser, this.uuid);
  if (!newChap.oldAuthors) {
    newChap.oldAuthors = [this.author];
  } else {
    newChap.oldAuthors.push(this.author);
  }
  newChap.author = newUser;
  await newChap.save('forked from ' + this.author);
  return newChap;
}

Chapter.prototype.getHead = function() {
  return git.getHead(global.storage + this.author + '/chapter/' + this.uuid);
}

let shaMatch = new RegExp("^[0-9a-f]{5,40}$");

var validate = async function(scraps) {
  var correctScraps = [];
  var truths = await Promise.all(scraps.map(async (sc) => {
    try {
      let nc = await scrap.reconstitute(sc[0], sc[1]);
      if (sc[2] != null && !(shaMatch.test(sc[2]))) {
        throw "sha must be either null or a valid sha!";
      }
      if (sc.length != 3) {
        throw "bad length, should have three items";
      }
      return true;
      correctScraps.push([sc[0], sc[1], sc[2]]);
    } catch (e) {
      return false;
    }
  }));
  if (truths.includes(false)) {
    return false;
  }
  return correctScraps;
}

let scrapDiff = function(newRef, old) {
  // newRef = [[author, uuid, sha], [author, uuid, sha]]
  // old = [[author, uuid, sha], [author, uuid, sha]]

  let running = "Updated scraps: ";
  let oldComp = old.map(e => e[0] + "," + e[1]); // join would give all elements; we don't want that
  let newComp = newRef.map(e => e[0] + "," + e[1]);

  for (let i in oldComp) {
    if (!newComp.includes(oldComp[i])) {
      let c = await scrap.reconstitute(oldRef[i][0], oldRef[i][1]);
      running += running + "Removed scrap " + c.text.slice(0,20); + "; "
    }
  }

  for (let i in newComp) {
    if (!oldComp.includes(newComp[i])) {
      let c = await scrap.reconstitute(newRef[i][0], newRef[i][1]);
      running += running + "Added scrap " + c.text.slice(0,20); + "; "
    }
  }
  return str.slice(0, -2) + '. ';
}

Chapter.prototype.update = async function(diff) {
  var success = true;
  var updateMsg = "update: ";
  for (var field in diff) {
    if (field === "name") {
      updateMsg += "changed name from " + this.name + " to " + diff[field] + ". ";
      this.name = diff[field];
    } else if (field === "author" || field === "uuid") {
      success = false;
      return JSON.stringify({error: "author and uuid are read-only", field: field});
    } else if (field === "scraps") {
      let valid = await validate(diff[field]);
      if (!valid) {
        return JSON.stringify({error: "invalid scraps!", field: diff[field]});
      }
      updateMsg += scrapDiff(diff['scraps'], this.scraps);
      this.scraps = diff[field];
    } else {
      success = false;
      return JSON.stringify({error: "unrecognized field " + field, field: field});
    }
  }
  var updateBlock = await this.save(updateMsg);
  updateBlock.message = updateMsg;
  return updateBlock;
}

var fleshOut = async function(truple) {
  for (let scr in truple) {
    var s = await scrap.reconstitute(truple[scr][0], truple[scr][1], truple[scr][2]);
    truple[scr].push(s.text);
  }
  return truple;
}

module.exports = {
  Chapter: Chapter,
  reconstitute: reconstitute,
  fleshOut: fleshOut
}
