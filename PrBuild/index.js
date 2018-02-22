const appCenterRequests = require('./api-appcenter');
const githubRequests = require('./api-github');

const startRepoBuild = function(repo_config, request_body) {
    const appcenter_token = process.env['APP_CENTER_TOKEN'];
    if (!appcenter_token) {
        return Promise.reject('Environment variable "APP_CENTER_TOKEN" has not been specified. Ignore.');
    }
    switch (repo_config.provider) {
    case 'github': break;
    case 'vsts': break;
    default: return Promise.reject(`Incorrect repo provider - "${repo_config.provider}", should be "github" or "vsts"`);
    }
    const action = request_body.action;
    const branch = request_body.pull_request.head.ref;
    const sha = request_body.pull_request.head.sha;
    const target_branch = request_body.pull_request.base.ref;
    const pull_request = request_body.pull_request.id;

    const github_token = process.env['GITHUB_TOKEN'];

    const { repo_owner, repo_name, appcenter_owner, appcenter_app, branch_template, appcenter_owner_type } = repo_config;
    const repo_path = `${repo_owner}/${repo_name}`;
    return new Promise((resolve, reject) => {
        if (action === 'opened' || action === 'synchronize') {
            log(`PR #${pull_request} was ${action} on '${branch}' trying to merge into '${target_branch}'...`);
            let new_branch_config = false;
            appCenterRequests.getBuildConfiguration(branch, appcenter_token, appcenter_owner, appcenter_app)
                .then(() => {}, (error) => {
                    if (error.statusCode === 404) {
                        return appCenterRequests.getBuildConfiguration(branch_template, appcenter_token, appcenter_owner, appcenter_app)
                            .then(created_branch_config => {
                                created_branch_config = JSON.parse(created_branch_config);
                                new_branch_config = true;
                                return appCenterRequests.createPrBuildConfiguration(created_branch_config, branch, appcenter_token, appcenter_owner, appcenter_app);
                            });
                    } else {
                        return Promise.reject(error);
                    }
                }).then(() => {
                    return appCenterRequests.startPrBuild(branch, sha, appcenter_token, appcenter_owner, appcenter_app);
                }).then(() => {
                    switch (repo_config.provider) {
                    case 'github': return githubRequests.reportGithubStatus(repo_path, branch, sha, github_token, appcenter_owner, appcenter_owner_type, appcenter_app);
                    default: break;
                    }
                }).then(response => {
                    log(response);
                    resolve(`App Center app: "${appcenter_app}". Started PR build for ${action} on ${new_branch_config ? 'existing' : 'new'} configuration...`);
                }).catch((error) => {
                    reject(error);
                });
        } else if (action === 'closed') {
            log(`PR closed, deleting build configuration for ${branch}.`);
            appCenterRequests.deletePrBuildConfiguration(branch, appcenter_token, appcenter_owner, appcenter_app)
                .then(() => resolve(`${branch} has been removed.`))
                .catch((error) => {
                    reject(error);
                });
        } else {
            log('Unsupported action detected.');
            resolve(`${action} is an unsupported action. Ignored.`);
        }
    });
};

const processWebhookRequest = function(request) {
    if (request.body && request.body.action) {
        const head_repo = request.body.pull_request.head.repo.full_name;
        const config = require('./config.json');
        const repos_configurations = config.repos.filter((repo) => {
            return head_repo === `${repo.repo_owner}/${repo.repo_name}`;
        });
        if (repos_configurations.length) {
            let build_promises = [];
            for (let index = 0; index < repos_configurations.length; index++) {
                const repo_config = repos_configurations[index];
                build_promises.push(startRepoBuild(repo_config, request.body)
                    .catch((error) => {
                        log(error);
                    })
                );
            }
            return new Promise((resolve, reject) => {
                Promise.all(build_promises)
                    .then((...args) => {
                        if (args.length) {
                            resolve(args.join('; '));
                        }
                    }).catch((error) => {
                        reject(error);
                    });
            });
        } else {
            return Promise.resolve(`Webhook was triggered by ${head_repo}, but there is no such kind configuratio for this repo. Ignored.`);
        }
    } else {
        return Promise.reject('Please post a valid webhook payload.');
    }
};

let log = function () {};

const resolveContext = function (body, status) {
    this.res = { body: body, status: status };
    this.done();
};

module.exports = function (context, request) {
    context.resolve = resolveContext;
    log = context.log;
    processWebhookRequest(request)
        .then(successMessage => context.resolve(successMessage))
        .catch((errorMessage) => {
            context.resolve(errorMessage, 400);
        });
};
