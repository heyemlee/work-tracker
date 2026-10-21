# Chrome Web Store

How Outbox Autofill is published, and what each field of the
[developer dashboard](https://chrome.google.com/webstore/devconsole) takes. The listing is **unlisted**: the store
doesn't show it in search, and anyone with its link can install it in one click and get its updates.

## The package

```bash
npm run ext:zip   # extension/.output/outbox-autofill-<version>-chrome.zip
```

Raise `version` in `extension/package.json` before each upload: the store refuses a version it already has. A
published build takes no page on this machine for Outbox; with Outbox running locally (`npm run dev`), use a
development build, `npm run ext:dev`, loaded unpacked from `extension/.output/chrome-mv3-dev`.

New item → upload the zip. Each later version: the item → **Package** → **Upload new package**, then **Submit for
review**.

## Store listing

The name and the summary come from the manifest, the summary in English and Chinese (`extension/public/_locales`).
The rest is entered here, once per language.

- **Category:** Productivity, Workflow & Planning.
- **Language:** English, then add Chinese (Simplified).
- **Store icon:** `extension/store/icon-128.png`.
- **Screenshots:** `extension/store/en/00-ready.png` … `04-logged.png` for English, `extension/store/zh/` for
  Chinese, in that order: the card on a form, filled, what's left to check, the AI settings, logged.
- **Small promo tile:** `extension/store/promo-440x280.png`.
- **Homepage URL:** `https://tracker.haoyang.us` · **Support URL:** `https://github.com/heyemlee/work-tracker/issues`

The screenshots are of a made-up company's form with a made-up applicant.

### Description, English

```text
Outbox Autofill fills job applications from the profile you keep in Outbox, and records each application you send.

How it works
• Open an application form and press Fill. Your name, contact details, links, resume, education, work history and the questions most forms repeat go in.
• Work authorization is answered by fixed rules for the job's country and always marked for you to check. Voluntary self-identification uses only the answers you set.
• Your own edits stay: Fill again redoes only what it put in, and it never submits a form.
• When you submit, the application is logged to your Outbox tracker with its link and resume version, and you can undo it.

Supported forms
Greenhouse, Lever, Ashby, Workday, Gem, iCIMS, SmartRecruiters, Workable, Jobvite and Eightfold, and other sites' forms with a resume upload. On LinkedIn and Indeed postings it logs the job; it doesn't fill their own apply flows.

Optional AI
Add your own Anthropic or OpenAI-compatible API key to draft answers to open questions and place fields the rules can't. Requests go from your browser straight to that provider. AI answers are marked for you to review.

Privacy
Your profile and resumes live in your Outbox account; the extension's settings and keys stay in your browser. No analytics, ads or tracking. Privacy policy: https://tracker.haoyang.us/privacy

Requires an Outbox account. Open source: https://github.com/heyemlee/work-tracker
```

### Description, Chinese

```text
Outbox Autofill 用你在 Outbox 里保存的资料填写求职申请，并记录你投出的每一份申请。

怎么用
• 打开申请页面，点「填写」：姓名、联系方式、链接、简历、教育和工作经历，以及大多数表单都会问的问题，都会填好。
• 工作许可按岗位所在国家用固定规则回答，并总会标出来请你确认。自愿身份调查只用你自己设定的答案。
• 你改过的不会被覆盖：「重新填写」只重做它自己填的部分；它从不替你提交。
• 你提交后，这份申请会带着链接和简历版本记到你的 Outbox 追踪列表里，可以撤销。

支持的表单
Greenhouse、Lever、Ashby、Workday、Gem、iCIMS、SmartRecruiters、Workable、Jobvite、Eightfold，以及其他网站上带简历上传的申请表。在 LinkedIn 和 Indeed 的职位页上只记录职位，不填它们自己的申请流程。

AI（可选）
填入你自己的 Anthropic 或兼容 OpenAI 的 API key 后，它可以为开放式问题起草答案，并处理规则放不下的字段。请求从你的浏览器直接发给该服务商。AI 写的答案会标出来请你检查。

隐私
你的资料和简历保存在你的 Outbox 账号里；扩展的设置和 key 只留在你的浏览器里。没有任何统计、广告或追踪。隐私政策：https://tracker.haoyang.us/privacy

需要 Outbox 账号。开源地址：https://github.com/heyemlee/work-tracker
```

## Privacy practices

**Single purpose**

```text
Outbox Autofill fills job application forms from the user's Outbox profile and records each application the user submits in their Outbox tracker.
```

**Permission justifications**

| Permission         | Justification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`          | Keeps on the user's computer the extension's settings and API keys, a copy of the user's profile, answers the user typed to reuse them, saved fill reports, and each tab's fill state.                                                                                                                                                                                                                                                                                                                              |
| `unlimitedStorage` | Caches the user's resume PDFs in IndexedDB, so the chosen one is attached to forms without downloading it each time, and keeps saved fill reports. Together they exceed the default quota.                                                                                                                                                                                                                                                                                                                          |
| `scripting`        | Injects the form-filling script into a page or embedded frame when an application form appears on a site outside the declared content-script matches, or when the user clicks the toolbar icon, and checks whether a frame already runs it.                                                                                                                                                                                                                                                                         |
| `webNavigation`    | Lists a tab's frames (`getAllFrames`) to find application forms embedded in iframes, as on iCIMS and companies' career sites that embed Greenhouse, and resets the toolbar icon when a page loads (`onCommitted`).                                                                                                                                                                                                                                                                                                  |
| Host permissions   | Application forms live on many hosts: applicant tracking systems (Greenhouse, Lever, Ashby, Workday, iCIMS and others) and companies' own career sites, often inside embedded frames. The extension needs to find a form on any site, read its questions, fill the answers and attach the resume in the page and its frames, read the posting for the application record, and call the user's Outbox (tracker.haoyang.us) and the AI provider the user chose. On pages without an application form it does nothing. |

**Remote code:** No, I am not using remote code.

**Data usage**, what the extension handles:

- [x] Personally identifiable information: the name, email, phone and address in the user's profile.
- [x] Health information: the disability status the user sets for voluntary self-identification questions.
- [ ] Financial and payment information
- [x] Authentication information: the user's AI API key and the Outbox session token.
- [ ] Personal communications
- [x] Location: the city, state and country in the profile.
- [x] Web history: the link and title of each posting the user applies to, logged to their Outbox.
- [x] User activity: noticing that the user submitted an application form, and the answers they typed, kept locally
      to offer next time.
- [x] Website content: the questions and posting text on application pages.

Certify all three statements (no selling or transfer outside the approved uses, no use unrelated to the single
purpose, no creditworthiness or lending).

**Privacy policy URL:** `https://tracker.haoyang.us/privacy` (`public/privacy.html`, live once the site is deployed).

## Distribution

- **Visibility:** Unlisted. Public later is a switch here, with no new review.
- **Regions:** all.

## Test instructions

The review needs an Outbox account. Create a Google account for it with no 2-step verification, let it in (below),
sign in with it once, and give it a made-up profile and resume. Then paste, with its address and password:

```text
Outbox Autofill fills forms from an Outbox account. Sign in at https://tracker.haoyang.us with this Google account (its profile and resume are made-up test data):
  Email: <review account>
  Password: <password>

1. Install the extension, then open https://tracker.haoyang.us once while signed in; the extension connects to it.
2. Open any job application on job-boards.greenhouse.io. The extension's card opens on the right; press Fill. Please don't submit the application.
3. The card's ⋯ menu → Settings shows the optional AI provider. No key is needed to try filling.
```

## Letting someone in

Outbox admits only listed Google accounts, and sign-in is Google's OAuth app in Testing:

1. Add their email to `OWNER_EMAILS`: `npx wrangler secret put OWNER_EMAILS` with the whole comma-separated list.
2. In the [Google Cloud console](https://console.cloud.google.com/auth/audience), **Audience** → **Test users**,
   add the same email (up to 100 while the app is in Testing).
3. Send them the store link. They install, sign in to Outbox, and the extension connects.
