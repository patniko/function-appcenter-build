var request = require('request-promise');
var _ = require('lodash');

module.exports = function (context, req) {
    context.log('Processing webhook request.');

    if (req.body && req.body.action) {
        const action = req.body.action;
        const head_repo = req.body.pull_request.head.repo.full_name;
        const branch = req.body.pull_request.head.ref;
        const sha = req.body.pull_request.head.sha;
        const target_branch = req.body.pull_request.base.ref;
        const pull_request = req.body.pull_request.id;
        
        const appcenter_token = process.env["APP_CENTER_TOKEN"];
        const github_token = process.env["GITHUB_TOKEN"];
        const config = require('./config.json');
        const { repo_owner, repo_name, appcenter_owner, appcenter_app, branch_template, branch_regex, appcenter_owner_type } = config;

        const repo_path = `${repo_owner}/${repo_name}`;

        let message = "";

        if(head_repo == repo_path) {

            if(action === "opened" || action === "synchronize") {
                context.log(`PR #${pull_request} was ${action} on '${branch}' trying to merge into '${target_branch}'...`);
                GetBuildConfiguration(branch, appcenter_token, appcenter_owner, appcenter_app)
                .then(branch_config => {
                    if(!branch_config) {
                        GetBuildConfiguration(branch_template, appcenter_token, appcenter_owner, appcenter_app)
                        .then(branch_config => {
                            CreatePrBuildConfiguration(branch_config, branch, appcenter_token, appcenter_owner, appcenter_app)
                            .then(() => {
                                StartPrBuild(branch, sha, appcenter_token, appcenter_owner, appcenter_app, appcenter_owner, appcenter_owner_type, appcenter_app)
                                .then(() => {
                                    ReportGithubStatus(repo_path, branch, sha, github_token)
                                    .then(response => {
                                        context.log(response);
                                        context.res = {
                                            body: `Started PR build for ${action} on new configuration...`
                                        };
                                        context.done();
                                    });
                                });
                            })
                        });
                    } else {
                        StartPrBuild(branch, sha, appcenter_token, appcenter_owner, appcenter_app)
                        .then(() => {
                            ReportGithubStatus(repo_path, branch, sha, github_token, appcenter_owner, appcenter_owner_type, appcenter_app)
                            .then(response => {
                                context.log(response);
                                context.res = {
                                    body: `Started PR build for ${action} on existing configuration...`
                                };
                                context.done();
                            });
                        });
                    }
                });
            } else if(action === "closed") {
                context.log(`PR closed, deleting build configuration for ${branch}.`);
                DeletePrBuildConfiguration(branch, appcenter_token, appcenter_owner, appcenter_app)
                .then(branch_config => {
                    context.res = {
                        body: `${branch} has been removed.`
                    };
                    context.done();
                });
            } else {
                context.log(`Unsupported action detected.`);
                context.res = {
                    body: `${action} is an unsupported action. Ignored.`
                };
                context.done();
            }
        } else {
            context.res = {
                body: `Configuration is for ${repo_path}, but this webhook was triggered by ${head_repo}. Ignored.`
            };
            context.done();
        }
    }
    else {
        context.res = {
            status: 400,
            body: "Please post a valid webhook payload."
        };

        context.done();
    }
};


function BuildUrl(endpoint, token, owner, app) {
    const options = {
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-API-Token': token },
        url: `https://api.appcenter.ms/v0.1/apps/${owner}/${app}${endpoint}`
    };
    return options;
}

function GetBuildConfiguration(branch, token, owner, app) {
    const endpoint = `/branches/${branch}/config`;
    var options = BuildUrl(endpoint, token, owner, app);
    return request(options)
    .then(result => {
        result = JSON.parse(result);
        if (result) {
            return result;
        }
    })
    .catch(error => {
        return null;
    });
}

function CreatePrBuildConfiguration(config, branch, token, owner, app) {
    // Disable distribute on build and change name over to new branch
    config.toolsets.distribution = {};
    config.branch.name = branch;
    config.trigger = "continuous";

    const options = BuildUrl(`/branches/${branch}/config`, token, owner, app);
    Object.assign(options, { method: "POST", body: JSON.stringify(config) })
    return request(options)
    .then((result) => {
        return result;
    });
}

function StartPrBuild(branch, sha, token, owner, app) {
    const payload = { sourceVersion: sha }

    const options = BuildUrl(`/branches/${branch}/builds`, token, owner, app);
    Object.assign(options, { method: "POST", body: JSON.stringify(payload) })
    return request(options)
    .then((result) => {
        return result;
    });
}

function DeletePrBuildConfiguration(branch, token, owner, app) {
    const options = BuildUrl(`/branches/${branch}/config`, token, owner, app);
    Object.assign(options, { method: "DELETE" })
    return request(options)
    .then((result) => {
        return result;
    })
}

function ReportGithubStatus(repo_path, branch, sha, token, owner, owner_type, app) {
    const options = {
        headers: { 'Accept': 'application/json', 'User-Agent': 'appcenter-ci', 'Content-Type': 'application/json', 'Authorization': `token ${token}` },
        url: `https://api.github.com/repos/${repo_path}/statuses/${sha}`
    };

    var report = {
        state: "pending",
        target_url: `https://appcenter.ms/${owner_type}/${owner}/apps/${app}/build/branches/${branch}`,
        description: "Running build in App Center...",
        context: "continuous-integration/appcenter"
    };

    Object.assign(options, { method: "POST", body: JSON.stringify(report) })

    return request(options)
    .then((result) => {
        return result;
    })
    .catch(error => {

    });
}
