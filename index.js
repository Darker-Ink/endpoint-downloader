const fs = require('fs');
const { request } = require('undici');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const cheerio = require('cheerio');
const config = require('./config.json');

const url = "https://canary.discord.com";
const interval = 1000 * 60 * 1; // 1 minute

const PromiseHandler = async (func) => {
    try {
        const finished = await func();

        return [
            finished,
            null
        ]
    } catch (err) {
        return [
            null,
            err
        ]
    }
}

const RequestData = async () => {
    const [finished, error] = await PromiseHandler(request(url + '/login'));
    
    if (error) {
        console.log(error);

        return RequestData();
    }

    const body = finished.body;

    const text = await body.text();
    const $ = cheerio.load(text);

    return $;
};

const RequestUrl = async (url) => {
    const [finished, error] = await PromiseHandler(request(url));
    
    if (error) {
        console.log(error);

        return RequestUrl(url);
    }

    return finished;
}

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

    // get the first 15 files
    const files = flipped.slice(0, 15);

    const mainBundle = flipped[1]; // main bundle should always be the second file

    let urlFile = null;

    const stringToLookFor = "/users/@me"

    for (const file of files) {
        const { body } = await RequestUrl(url + file);

        const text = await body.text();

        if (text.includes(stringToLookFor)) {
            urlFile = file;

            break;
        }
    }

    if (!mainBundle || !urlFile) {
        const [, error] = await RequestUrl(request(config.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content: `<@379781622704111626> Failed to get routes.`
            })
        }));

        if (error) {
            console.log(error);
        }

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

    const jsDownload = await RequestUrl(url + urlFile);

    const js = await jsDownload.body.text();

    fs.writeFileSync('./currentRoutes.js', js);

    fs.writeFileSync('./metadata.json', JSON.stringify({
        mainBundle,
        urls: urlFile
    }));

    await exec('git add currentRoutes.js metadata.json');
    await exec('git commit -m "New Endpoints"');
    await exec('git push origin master');

    const [, error]= await PromiseHandler(request(config.url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            content: `File changed, Updating..., <${url}${urlFile}>`
        })
    }));

    if (error) {
        console.log(error);
    }
};

start();

setInterval(start, interval);