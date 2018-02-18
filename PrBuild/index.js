const appCenterRequests = require('./requests/appcenter');
const githubRequests = require('./requests/github');

module.exports = function (context, req) {
    context.log('Processing webhook request.');

    if (req.body && req.body.action) {
        const action = req.body.action;
        const head_repo = req.body.pull_request.head.repo.full_name;
        const branch = req.body.pull_request.head.ref;
        const sha = req.body.pull_request.head.sha;
        const target_branch = req.body.pull_request.base.ref;
        const pull_request = req.body.pull_request.id;

        const appcenter_token = process.env['APP_CENTER_TOKEN'];
        const github_token = process.env['GITHUB_TOKEN'];

        const config = require('./config.json');
        const repo_config = config.repos.filter((repo) => {
            return head_repo === `${repo.repo_owner}/${repo.repo_name}`;
        });

        if (repo_config.length === 1) {
            const { repo_owner, repo_name, appcenter_owner, appcenter_app, branch_template, appcenter_owner_type } = repo_config[0];
            const repo_path = `${repo_owner}/${repo_name}`;
            if (action === 'opened' || action === 'synchronize') {
                context.log(`PR #${pull_request} was ${action} on '${branch}' trying to merge into '${target_branch}'...`);
                appCenterRequests.getBuildConfiguration(branch, appcenter_token, appcenter_owner, appcenter_app)
                    .then(branch_config => {
                        if (!branch_config) {
                            appCenterRequests.getBuildConfiguration(branch_template, appcenter_token, appcenter_owner, appcenter_app)
                                .then(branch_config => appCenterRequests.createPrBuildConfiguration(branch_config, branch, appcenter_token, appcenter_owner, appcenter_app))
                                .then(() => appCenterRequests.startPrBuild(branch, sha, appcenter_token, appcenter_owner, appcenter_app, appcenter_owner, appcenter_owner_type, appcenter_app))
                                .then(() => appCenterRequests.reportGithubStatus(repo_path, branch, sha, github_token))
                                .then(response => {
                                    context.log(response);
                                    resolveContext(`Started PR build for ${action} on new configuration...`);
                                });
                        } else {
                            appCenterRequests.startPrBuild(branch, sha, appcenter_token, appcenter_owner, appcenter_app)
                                .then(() => {
                                    return githubRequests.reportGithubStatus(repo_path, branch, sha, github_token, appcenter_owner, appcenter_owner_type, appcenter_app);
                                }).then(response => {
                                    context.log(response);
                                    resolveContext(`Started PR build for ${action} on existing configuration...`);
                                });
                        }
                    });
            } else if (action === 'closed') {
                context.log(`PR closed, deleting build configuration for ${branch}.`);
                appCenterRequests.deletePrBuildConfiguration(branch, appcenter_token, appcenter_owner, appcenter_app)
                    .then(() => resolveContext(`${branch} has been removed.`));
            } else {
                context.log('Unsupported action detected.');
                resolveContext(`${action} is an unsupported action. Ignored.`);
            }
        } else {
            resolveContext(`Webhook was triggered by ${head_repo}, but there is no such kind configuratio for this repo. Ignored.`);
        }
    } else {
        resolveContext('Please post a valid webhook payload.', 400);
    }

    function resolveContext(body, status) {
        context.res = {
            status: status,
            body: body
        };
        context.done();
    }
};
