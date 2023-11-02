const fs = require('fs');
const { request } = require('undici');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const cheerio = require('cheerio');
const config = require('./config.json');

const url = "https://canary.discord.com";
const interval = 1000 * 60 * 1; // 1 minute

const RequestData = async () => {
    const { body } = await request(url + '/login');
    const text = await body.text();
    const $ = cheerio.load(text);

    return $;
};

const start = async () => {
    if (!fs.existsSync('./metadata.json')) {
        fs.writeFileSync('./metadata.json', JSON.stringify({
            mainBundle: '',
            urls: ''
        }));
    }

    const $ = await RequestData();

    const scripts = $('body script');

    const srcs = scripts.map((_, el) => {
        return $(el).attr('src');
    }).get();

    const flipped = srcs.reverse();

    // get the first 8 files
    const files = flipped.slice(0, 8);

    const mainBundle = flipped[1]; // main bundle should always be the second file

    let urlFile = null;

    const stringToLookFor = "/users/@me"

    for (const file of files) {
        const { body } = await request(url + file);

        const text = await body.text();

        if (text.includes(stringToLookFor)) {
            urlFile = file;

            break;
        }
    }

    if (!mainBundle || !urlFile) {
        await request(config.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content: `<@379781622704111626> Failed to get routes.`
            })
        });

        return;
    }

    console.log(`Main Bundle: ${mainBundle}`);
    console.log(`URLs: ${urlFile}`);

    const data = fs.readFileSync('./metadata.json');

    if (data) {
        const json = JSON.parse(data);

        if (json.mainBundle === mainBundle && json.urls === urlFile) {
            console.log('No changes');

            return;
        }
    }

    const jsDownload = await request(url + urlFile);

    const js = await jsDownload.body.text();

    fs.writeFileSync('./currentRoutes.js', js);

    fs.writeFileSync('./metadata.json', JSON.stringify({
        mainBundle,
        urls: urlFile
    }));

    await exec('git add currentRoutes.js metadata.json');
    await exec('git commit -m "New Endpoints"');
    await exec('git push origin master');

    await request(config.url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            content: `File changed, Updating..., <${url}${urlFile}>`
        })
    });
};

start();

setInterval(start, interval);