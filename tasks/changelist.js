/*
 * grunt-changelist
 * http://pay.qq.com/
 *
 * Copyright (c) 2013 Bingo(xsbchen@tencent.com)
 * Licensed under the MIT license.
 */

'use strict';
module.exports = function(grunt) {
  var dirdiff = require('dirdiff');
  var path = require('path');
  var tagRevisionFileName = '_revision_';

  grunt.registerMultiTask('changelist', '获取指定SVN项目主线与最新TAG之间的changelist', function() {
    var taskDone = this.async();
    var targetDir = grunt.template.process(this.data.src);
    var tagsURL = grunt.template.process(this.data.tags);

    var callback = this.data.callback;
    var opts = this.options({
      buildCmd: 'self.cmd',
      outputDir: 'dist',
      tmp: 'tag-tmp/'
    });
    var tmpDir = opts.tmp;
    var baseDir = unixifyPath(path.join(tmpDir, opts.outputDir));

    grunt.verbose.writeflags(opts, 'Options');

    getHeadTagURL(tagsURL, function(tagHeadRevision, headTagURL) {
      if (tagHeadRevision) {
        // 检查tmp目录是否过时
        if (!isTagTmpExpired(tmpDir, tagHeadRevision)) {
          grunt.log.writeln('TAG cache at ' + tagHeadRevision.cyan + ' which in ' + tmpDir.cyan + ' is still fresh, Skip export!');
          getChangeList(baseDir, targetDir, callback, taskDone);
        } else {
          // 清理临时文件夹
          if (grunt.file.exists(tmpDir)) {
            grunt.file.delete(tmpDir, {
              force: true
            });
          }

          exportTag(tagHeadRevision, headTagURL, tmpDir, function(tmpDir) {
            buildTag(opts.buildCmd, tmpDir, function(tmpDir) {
              getChangeList(baseDir, targetDir, callback, taskDone);
            });
          });
        }
      } else {
        taskDone();
      }
    });
  });

  function getChangeList(baseDir, targetDir, callback, done) {
    // 比较文件夹
    grunt.log.write('Comparing ' + baseDir.cyan + ' to ' + targetDir.cyan + '...');
    dirdiff(baseDir, targetDir, {
      fileContents: true
    }, function(err, diffs) {
      if (err) {
        grunt.warn(err);
      }

      grunt.log.ok();

      var files = [];
      diffs.forEach(function(obj) {
        grunt.verbose.writeflags(obj, 'Diff Info');

        if (obj.file2 && grunt.file.isFile(path.join(targetDir, obj.file2))) {
          files.push(obj.file2);
        }
      });

      grunt.log.writeln('Total has ' + files.length.toString().cyan + ' ' + (files.length > 1 ? 'changes' : 'change') + '.');

      // 输出结果
      if (typeof callback === 'function') {
        grunt.log.write('Change list has been saved by callback function...');
        try {
          callback(files, grunt.util.linefeed);
          grunt.log.ok();
        } catch (e) {
          grunt.log.error();
          grunt.verbose.error('CallbackException' + e);
        }
      } else if (callback) {
        var outputFile = grunt.template.process(callback);
        grunt.file.write(outputFile, files.join(grunt.util.linefeed));
        grunt.log.writeln('Change list has been saved in ' + outputFile.cyan + '.');
      }

      done();
    });
  }

  // 获取最新的TAG，tagsURL为完整的URL
  function getHeadTagURL(tagsURL, done) {
    grunt.log.write('Get HEAD TAG form Server...');

    var matchRegexp = / {2}(\d{5,}) (\w+) .+ (.+)/g;
    grunt.util.spawn({
      cmd: 'svn',
      args: ['ls', '--non-interactive', '-v', tagsURL]
    }, function(error, result, code) {
      if (error) {
        onSpawnError(error);
      }

      grunt.log.ok();

      var matchResult;
      var stdout = result.stdout;
      var tags = {};
      var headTagURL = null;
      var tagHeadRevision = null;

      if (stdout) {
        while (matchResult = matchRegexp.exec(stdout)) {
          if (matchResult[3] !== './') {
            tags[matchResult[1]] = {
              revision: matchResult[1],
              author: matchResult[2],
              path: matchResult[3]
            };
          }
        }

        tagHeadRevision = Object.keys(tags).sort().reverse()[0];

        if (tagHeadRevision) {
          var tagInfo = tags[tagHeadRevision];
          headTagURL = tagsURL + '/' + tagInfo.path;
          grunt.log.writeln('Head Tag: ' + tagInfo.path + '@' + tagInfo.revision + '[' + tagInfo.author + ']');
        }
      }

      grunt.verbose.writeflags(result, 'GetHeadTagURL');

      done(tagHeadRevision, headTagURL);
    });
  }

  // 导出TAG
  function exportTag(tagHeadRevision, headTagURL, tmpDir, done) {
    var headTagName = path.basename(headTagURL);

    grunt.log.write('Export TAG ' + headTagName.cyan + ' to ' + tmpDir.cyan + '...');

    var matchRegexp = / {2}(\d{5,}) .+ (.+)/g;
    grunt.util.spawn({
      cmd: 'svn',
      args: ['export', '--non-interactive', '--force', '-r', 'HEAD', headTagURL, path.resolve(tmpDir)]
    }, function(error, result, code) {
      if (error) {
        onSpawnError(error);
      }

      saveTagRevision(tmpDir, tagHeadRevision);
      grunt.log.ok();
      grunt.verbose.writeflags(result, 'ExportTag');

      done(tmpDir);
    });
  }

  function buildTag(cmd, tmpDir, done) {
    grunt.log.write('Build TAG in ' + tmpDir.cyan + '...');

    // 执行tag的selfBuild脚本
    cmd = path.resolve(tmpDir, cmd);
    grunt.util.spawn({
      cmd: cmd,
      opts: {
        cwd: path.resolve(tmpDir)
      }
    }, function(error, result, code) {
      if (error) {
        onSpawnError(error);
      }

      grunt.log.ok();
      grunt.verbose.writeflags(result, 'BuildTag');

      done(tmpDir);
    });
  }

  function updateTrunk(trunkDir, done) {
    done(trunkDir);
  }

  function isTagTmpExpired(tmpDir, tagHeadRevision) {
    return parseInt(tagHeadRevision, 10) > parseInt(getTagRevision(tmpDir), 10);
  }

  function saveTagRevision(tmpDir, revision) {
    grunt.file.write(path.join(tmpDir, tagRevisionFileName), revision);
  }

  function getTagRevision(tmpDir) {
    var tagRevisionFile = path.join(tmpDir, tagRevisionFileName);
    return grunt.file.isFile(tagRevisionFile) ? grunt.file.read(tagRevisionFile) : 0;
  }

  function unixifyPath(filepath) {
    if (process.platform === 'win32') {
      return filepath.replace(/\\/g, '/');
    } else {
      return filepath;
    }
  }

  function onSpawnError(err) {
    grunt.log.error();
    if (err.toString().indexOf('not found: svn') >= 0) {
      grunt.log.error('当你看到这个提示，说明你安装TSVN时没有选择安装SVN命令行。');
      grunt.log.error('请重装TortoiseSVN最新版本请选择附带的svn命令行；');
      grunt.log.error('或者手工安装svn命令行。如有疑问RTX:xsbchen');
    } else if (err.toString().indexOf('Authentication failed') >= 0) {
        grunt.log.error('身份认证失败，请尝试运行svn up并保存认证信息。');
    }
    grunt.warn(err);
  }
};