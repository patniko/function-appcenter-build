const request = require('request-promise');

module.exports = {
    reportGithubStatus: function(repo_path, branch, sha, token, owner, owner_type, app) {
        const options = {
            headers: { 'Accept': 'application/json', 'User-Agent': 'appcenter-ci', 'Content-Type': 'application/json', 'Authorization': `token ${token}` },
            url: `https://api.github.com/repos/${repo_path}/statuses/${sha}`
        };

        var report = {
            state: 'pending',
            target_url: `https://appcenter.ms/${owner_type}/${owner}/apps/${app}/build/branches/${branch}`,
            description: 'Running build in App Center...',
            context: 'continuous-integration/appcenter'
        };

        Object.assign(options, { method: 'POST', body: JSON.stringify(report) });

        return request(options);
    }
};
