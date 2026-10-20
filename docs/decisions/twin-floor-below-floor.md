# The 164 pairs the tightened twin floor refuses

The evidence for [delivered-twin-floor.md](delivered-twin-floor.md), machine-generated rather than
hand-copied: every pair `npm run audit:twin-corpus` reports below the floor, with the anchors the
delivery pass fused it on. `legs failed` names the leg(s) the pair does not meet — `entity` (no
capitalisation that selects a name, on either side), `words` (fewer than three shared content words),
`both`.

Reproduce with `nvm use 22 && npm run audit:twin-corpus`; the numbers move with the corpus, and this
read is the 30-day window ending 2026-10-20.

Read by `npm run audit:twin-corpus` on 2026-10-20 (Node 22, 30-day window):
272 pairs newly fused by ruling #18's widening, **164 of them below the floor** —
entity leg only 56, content-words leg only 75, both 33.
Plus 19 pre-existing fusions below it (another rule's; reported, not tuned).

| # | legs failed | shared entity | shared content words | A | B |
| --- | --- | --- | --- | --- | --- |
| 1 | words | ai | agent, hacker | Hackers hit AI coding tool OpenCode, running up charges on users’ AI accounts | A hacker broke into John Deere and SharkNinja with an army of AI agents |
| 2 | words | ai | agent, hacker | Hackers hit AI coding tool OpenCode, running up charges on users’ AI accounts | Hackers suspected of using AI agents for cyberattacks on South Korean banks, exposing data from about 25,000 customers |
| 3 | entity | — | actor, hacker, threat | Hackers Exploit Plex2Shell Flaws to Install Crypto Miners and Linux Proxy Backdoor | Hackers Use Compromised ConnectWise Credential to Sign In to 173 Microsoft 365 Tenants |
| 4 | entity | — | day, exploit, flaw, hacker, server | Hackers Exploit Plex2Shell Flaws to Install Crypto Miners and Linux Proxy Backdoor | China-Linked Hackers Exploited BeyondTrust Zero-Day to Take Over Remote Support Servers |
| 5 | entity | — | backdoor, exploit, flaw, hacker, server | Hackers Exploit Plex2Shell Flaws to Install Crypto Miners and Linux Proxy Backdoor | Hackers Backdoor Nextcloud Servers Through Critical Flaw in Collabora’s Built-in CODE App |
| 6 | entity | — | crypto, exploit, threat | Hackers Exploit Plex2Shell Flaws to Install Crypto Miners and Linux Proxy Backdoor | ⚡ Weekly Recap: $387M Crypto Hack, Citrix Exploits, AI Agents Go Off-Script, and More Threats |
| 7 | entity | — | actor, cryptocurrency, hacker, threat | Hackers Exploit Plex2Shell Flaws to Install Crypto Miners and Linux Proxy Backdoor | Bitget Says Suspected North Korean Hackers Stole $351.6M After Backend Compromise |
| 8 | entity | — | actor, chain, day, deploy, exploit, hacker, threat | Hackers Exploit Plex2Shell Flaws to Install Crypto Miners and Linux Proxy Backdoor | Chinese Hackers Exploit Chrome-Windows Zero-Day Chain to Deploy CLEANGULP Malware |
| 9 | words | ai | agent, hacker | A Chinese hacker used AI agents to break into more than 100 company websites | Hackers suspected of using AI agents for cyberattacks on South Korean banks, exposing data from about 25,000 customers |
| 10 | words | ai | agent, hacker | A Chinese hacker used AI agents to break into more than 100 company websites | AI agents hacked the hackers, stealing email addresses from security research org |
| 11 | words | ai | hacker | A hacker broke into John Deere and SharkNinja with an army of AI agents | CrowdStrike finds possible bank hacker's CV among exposed AI logs |
| 12 | words | ai | agent, hacker | A hacker broke into John Deere and SharkNinja with an army of AI agents | Hackers suspected of using AI agents for cyberattacks on South Korean banks, exposing data from about 25,000 customers |
| 13 | words | ai | agent | A hacker broke into John Deere and SharkNinja with an army of AI agents | California subpoenas OpenAI over rogue AI agents conducting hacking attacks |
| 14 | both | — | formerly, hacker | Hackers Use Compromised ConnectWise Credential to Sign In to 173 Microsoft 365 Tenants | China-Linked Hackers Exploited BeyondTrust Zero-Day to Take Over Remote Support Servers |
| 15 | entity | — | acces, cybersecurity, hacker | Hackers Use Compromised ConnectWise Credential to Sign In to 173 Microsoft 365 Tenants | FBI Says China-Linked Hackers Ran Portal Giving Third Parties Access to Stolen Emails |
| 16 | both | — | customer, hacker | Hackers Use Compromised ConnectWise Credential to Sign In to 173 Microsoft 365 Tenants | Hackers suspected of using AI agents for cyberattacks on South Korean banks, exposing data from about 25,000 customers |
| 17 | entity | — | hacker, microsoft, threat | Hackers Use Compromised ConnectWise Credential to Sign In to 173 Microsoft 365 Tenants | Microsoft catches hackers exploiting Zimbra bug before disclosure |
| 18 | entity | — | acces, hacker, microsoft, use | Hackers Use Compromised ConnectWise Credential to Sign In to 173 Microsoft 365 Tenants | Hackers Use NeedyMantis to Maintain Long-Term Access in Breached Networks |
| 19 | entity | — | actor, hacker, threat | Hackers Use Compromised ConnectWise Credential to Sign In to 173 Microsoft 365 Tenants | Bitget Says Suspected North Korean Hackers Stole $351.6M After Backend Compromise |
| 20 | entity | — | actor, hacker, microsoft, threat | Hackers Use Compromised ConnectWise Credential to Sign In to 173 Microsoft 365 Tenants | Chinese Hackers Exploit Chrome-Windows Zero-Day Chain to Deploy CLEANGULP Malware |
| 21 | entity | — | agent, hack, openai, said | OpenAI models hacked a crypto wallet and breached more websites | OpenAI agents tried to hack Wikipedia tools and flooded it with traffic |
| 22 | both | — | hack, openai | OpenAI models hacked a crypto wallet and breached more websites | OpenAI admits response to Australian government hacks 'not good enough' |
| 23 | both | — | hack, openai | OpenAI models hacked a crypto wallet and breached more websites | OpenAI says its review into hacks, including on Australian government sites, is costing $500,000 a day |
| 24 | both | — | openai, said | OpenAI models hacked a crypto wallet and breached more websites | OpenAI alerts 100+ orgs that its 'misaligned models' attempted to break in - or worse |
| 25 | words | openai | hack, openai | OpenAI models hacked a crypto wallet and breached more websites | Lawsuit demands OpenAI halt unsafe development that caused Hugging Face hack |
| 26 | words | openai | hack, openai | OpenAI models hacked a crypto wallet and breached more websites | ‘New kind of cyber incident’: OpenAI apologises for Medicare hack and reveals extent of attack |
| 27 | words | openai | hack, openai | OpenAI models hacked a crypto wallet and breached more websites | Anthropic will not appear at Senate inquiry into AI and datacentres amid fallout from OpenAI hack |
| 28 | words | openai | hack, openai | OpenAI models hacked a crypto wallet and breached more websites | Why did an OpenAI system hack Australia's health system - and can it be stopped in the future? |
| 29 | entity | — | exploit, flaw, hacker, server | China-Linked Hackers Exploited BeyondTrust Zero-Day to Take Over Remote Support Servers | Hackers Backdoor Nextcloud Servers Through Critical Flaw in Collabora’s Built-in CODE App |
| 30 | entity | — | china, hacker, link | China-Linked Hackers Exploited BeyondTrust Zero-Day to Take Over Remote Support Servers | FBI Says China-Linked Hackers Ran Portal Giving Third Parties Access to Stolen Emails |
| 31 | entity | — | day, disclos, exploit, hacker, zero | China-Linked Hackers Exploited BeyondTrust Zero-Day to Take Over Remote Support Servers | Chinese Hackers Exploit Chrome-Windows Zero-Day Chain to Deploy CLEANGULP Malware |
| 32 | entity | — | hack, multi, reward | Multi-Reward Hacking: From Aggregation-Induced Drift to Trust-Anchored Defense | Reward Hacking as a Transmissible Strategy in Multi-Agent Coding Systems |
| 33 | entity | — | author, hack, multi, reward | Multi-Reward Hacking: From Aggregation-Induced Drift to Trust-Anchored Defense | RH-Detect: A Unified Benchmark for Reward Hacking Detection |
| 34 | both | — | hack, reward | Multi-Reward Hacking: From Aggregation-Induced Drift to Trust-Anchored Defense | Beyond Reward Hacking: Proxy Divergence Across Four Layers of a Staged Humanoid Learning Pipeline |
| 35 | both | — | hack, reward | Diagnosing and Correcting Reward Hacking in Verifiable Instruction Following | RH-Detect: A Unified Benchmark for Reward Hacking Detection |
| 36 | both | — | hack, reward | Diagnosing and Correcting Reward Hacking in Verifiable Instruction Following | Beyond Reward Hacking: Proxy Divergence Across Four Layers of a Staged Humanoid Learning Pipeline |
| 37 | entity | — | agent, call, hack | FBI Arrests Suspect in FBI-Hacking Case | Proof-of-Use: Mitigating Tool-Call Hacking in Deep Research Agents |
| 38 | entity | — | fbi, hacker, stole | FBI Arrests Suspect in FBI-Hacking Case | FBI Says China-Linked Hackers Ran Portal Giving Third Parties Access to Stolen Emails |
| 39 | entity | — | agent, fbi, hacker | FBI Arrests Suspect in FBI-Hacking Case | FBI reportedly declares ‘cyber security incident’ after hackers steal agents’ personal data |
| 40 | entity | — | fbi, group, hack, hacker, shinyhunter | FBI Arrests Suspect in FBI-Hacking Case | FBI rushes to investigate if ShinyHunters hack of thousands of employees is real |
| 41 | words | ai | hack | Imagine there's no Shiny Hunters – AI could make human hacking crews obsolete | AI is supercharging hacking, and your local hospitals and banks aren’t ready |
| 42 | words | hunters, shiny | hunter, shiny | Imagine there's no Shiny Hunters – AI could make human hacking crews obsolete | Dutch Police Arrest ‘Reformed’ Hacker in Shiny Hunters Investigation |
| 43 | entity | — | hack, multi, reward | Reward Hacking as a Transmissible Strategy in Multi-Agent Coding Systems | RH-Detect: A Unified Benchmark for Reward Hacking Detection |
| 44 | both | — | hack, reward | Reward Hacking as a Transmissible Strategy in Multi-Agent Coding Systems | Beyond Reward Hacking: Proxy Divergence Across Four Layers of a Staged Humanoid Learning Pipeline |
| 45 | entity | — | agent, hack, reward | Reward Hacking as a Transmissible Strategy in Multi-Agent Coding Systems | Reward Hacking Challenges Oversight of Autonomous Research Agents |
| 46 | both | — | agent, hack | Reward Hacking as a Transmissible Strategy in Multi-Agent Coding Systems | Hacking group ShinyHunters claims it breached the FBI, stole agents’ and applicants’ data |
| 47 | entity | — | fbi, october, portal, said, stolen | FBI Arrests Another ShinyHunters Suspect Reportedly Involved in Its Jobs Portal Hack | FBI Says China-Linked Hackers Ran Portal Giving Third Parties Access to Stolen Emails |
| 48 | words | fbi | fbi, hack | FBI Arrests Another ShinyHunters Suspect Reportedly Involved in Its Jobs Portal Hack | Passengers recount chaos on Tel Aviv flight. And, FBI probes employee-data hack |
| 49 | both | — | agent, hack | FBI Arrests Another ShinyHunters Suspect Reportedly Involved in Its Jobs Portal Hack | ⚡ Weekly Recap: $387M Crypto Hack, Citrix Exploits, AI Agents Go Off-Script, and More Threats |
| 50 | both | — | hack | Hack the World: Why hackathons are still the best place to learn to build | Why Australia chose the world's biggest political stage to reveal OpenAI hack |
| 51 | both | — | hack | Hack the World: Why hackathons are still the best place to learn to build | Why did an OpenAI system hack Australia's health system - and can it be stopped in the future? |
| 52 | entity | — | google, hack, three | Three Teams Demonstrate Remote Hacks of Fully Patched Google Pixel 10 at Pwn2Own | Google confirms Gemini models hacked three companies in May 2026 |
| 53 | both | — | benchmark, reward | How Hackable Is Your Speech Quality Metric? A Corrected Protocol, a Benchmark, and What Patching Buys | RH-Detect: A Unified Benchmark for Reward Hacking Detection |
| 54 | both | — | hack, reward | RH-Detect: A Unified Benchmark for Reward Hacking Detection | Beyond Reward Hacking: Proxy Divergence Across Four Layers of a Staged Humanoid Learning Pipeline |
| 55 | both | — | famili, hack | RH-Detect: A Unified Benchmark for Reward Hacking Detection | Hacking group ShinyHunters claims it breached the FBI, stole agents’ and applicants’ data |
| 56 | entity | — | agent, hack, research | Proof-of-Use: Mitigating Tool-Call Hacking in Deep Research Agents | Reward Hacking Challenges Oversight of Autonomous Research Agents |
| 57 | both | — | hack | US disrupts Chinese hacking tools as 7 govts warn of PRC spies stealing sensitive data worldwide | Iranian national extradited to US over alleged $3.4 billion state-backed hacking campaign in rare legal win for law enforcement |
| 58 | words | chinese | chinese, malware | US disrupts Chinese hacking tools as 7 govts warn of PRC spies stealing sensitive data worldwide | Chinese Hackers Exploit Chrome-Windows Zero-Day Chain to Deploy CLEANGULP Malware |
| 59 | entity | — | hacker, organization, said | FBI Says China-Linked Hackers Ran Portal Giving Third Parties Access to Stolen Emails | Hackers obtain counterfeit TLS certificates for Google and other large services |
| 60 | both | — | hacker | FBI Says China-Linked Hackers Ran Portal Giving Third Parties Access to Stolen Emails | Hackers suspected of using AI agents for cyberattacks on South Korean banks, exposing data from about 25,000 customers |
| 61 | entity | — | government, hacker, said | FBI Says China-Linked Hackers Ran Portal Giving Third Parties Access to Stolen Emails | Hackers steal 8 million citizens’ records from Danish government database |
| 62 | entity | — | acces, hacker, said | FBI Says China-Linked Hackers Ran Portal Giving Third Parties Access to Stolen Emails | Hackers Use NeedyMantis to Maintain Long-Term Access in Breached Networks |
| 63 | both | — | fbi, hacker | FBI Says China-Linked Hackers Ran Portal Giving Third Parties Access to Stolen Emails | FBI reportedly declares ‘cyber security incident’ after hackers steal agents’ personal data |
| 64 | words | fbi | fbi | FBI Says China-Linked Hackers Ran Portal Giving Third Parties Access to Stolen Emails | Inside the FBI hack: Agents fearful and angry after 'dangerous' data breach |
| 65 | words | fbi | fbi, stolen | FBI Says China-Linked Hackers Ran Portal Giving Third Parties Access to Stolen Emails | Special agents' blood and urine test results stolen in FBI hack |
| 66 | entity | — | hacker, said, stole, stolen | FBI Says China-Linked Hackers Ran Portal Giving Third Parties Access to Stolen Emails | Bitget Says Suspected North Korean Hackers Stole $351.6M After Backend Compromise |
| 67 | entity | — | fbi, hacker, stolen | FBI Says China-Linked Hackers Ran Portal Giving Third Parties Access to Stolen Emails | FBI rushes to investigate if ShinyHunters hack of thousands of employees is real |
| 68 | entity | — | fbi, hacker, stolen | FBI Says China-Linked Hackers Ran Portal Giving Third Parties Access to Stolen Emails | FBI investigates breach of jobs website as hackers claim ‘very sensitive data’ stolen |
| 69 | both | — | chinese, hacker | FBI Says China-Linked Hackers Ran Portal Giving Third Parties Access to Stolen Emails | Chinese Hackers Exploit Chrome-Windows Zero-Day Chain to Deploy CLEANGULP Malware |
| 70 | entity | — | asos, customer, hacker | Asos confirms breach of customer data after hackers send rogue app notification | Asos says customer data accessed by hacker posing as trusted contact |
| 71 | words | ai | attack, investigat | CrowdStrike finds possible bank hacker's CV among exposed AI logs | California subpoenas OpenAI over rogue AI agents conducting hacking attacks |
| 72 | words | ai | bank, financial | CrowdStrike finds possible bank hacker's CV among exposed AI logs | AI is supercharging hacking, and your local hospitals and banks aren’t ready |
| 73 | entity | — | actor, chinese, threat | Chinese Government-linked Cyber Threat Actors Combine Automated and Hands-on Hacking Tools to Steal Sensitive Data | Chinese Hackers Exploit Chrome-Windows Zero-Day Chain to Deploy CLEANGULP Malware |
| 74 | entity | — | government, hack, threat | Chinese Government-linked Cyber Threat Actors Combine Automated and Hands-on Hacking Tools to Steal Sensitive Data | Hacking group ShinyHunters claims it breached the FBI, stole agents’ and applicants’ data |
| 75 | both | — | hack, openai | OpenAI used AI to help write email warning Australian government AI had hacked its websites | OpenAI agents tried to hack Wikipedia tools and flooded it with traffic |
| 76 | entity | — | government, hack, openai | OpenAI used AI to help write email warning Australian government AI had hacked its websites | OpenAI disclose another hack on government department in Australia |
| 77 | both | — | hacker | Hackers obtain counterfeit TLS certificates for Google and other large services | Hackers suspected of using AI agents for cyberattacks on South Korean banks, exposing data from about 25,000 customers |
| 78 | both | — | hacker, hijack | Hackers obtain counterfeit TLS certificates for Google and other large services | Hackers hijacked Microsoft's X account for a scam featuring everyone's least-favorite tech mascot Clippy |
| 79 | both | — | hacker, said | Hackers obtain counterfeit TLS certificates for Google and other large services | Hackers steal 8 million citizens’ records from Danish government database |
| 80 | both | — | hacker, said | Hackers obtain counterfeit TLS certificates for Google and other large services | Bitget Says Suspected North Korean Hackers Stole $351.6M After Backend Compromise |
| 81 | both | — | hack, openai | OpenAI agents tried to hack Wikipedia tools and flooded it with traffic | OpenAI admits response to Australian government hacks 'not good enough' |
| 82 | entity | — | action, hack, openai | OpenAI agents tried to hack Wikipedia tools and flooded it with traffic | OpenAI must explain action taken to stop AI hacking Australians’ private data, chair of federal inquiry says |
| 83 | both | — | hack, openai | OpenAI agents tried to hack Wikipedia tools and flooded it with traffic | OpenAI says its review into hacks, including on Australian government sites, is costing $500,000 a day |
| 84 | entity | — | attempt, openai, said, system | OpenAI agents tried to hack Wikipedia tools and flooded it with traffic | OpenAI alerts 100+ orgs that its 'misaligned models' attempted to break in - or worse |
| 85 | words | openai | hack, openai | OpenAI agents tried to hack Wikipedia tools and flooded it with traffic | ‘New kind of cyber incident’: OpenAI apologises for Medicare hack and reveals extent of attack |
| 86 | words | openai | hack, openai | OpenAI agents tried to hack Wikipedia tools and flooded it with traffic | Anthropic will not appear at Senate inquiry into AI and datacentres amid fallout from OpenAI hack |
| 87 | words | openai | hack, openai | OpenAI agents tried to hack Wikipedia tools and flooded it with traffic | Why Australia chose the world's biggest political stage to reveal OpenAI hack |
| 88 | words | openai | hack, openai | OpenAI agents tried to hack Wikipedia tools and flooded it with traffic | Australia to investigate if OpenAI hack of government health website broke the law |
| 89 | entity | — | agent, hack, openai | OpenAI agents tried to hack Wikipedia tools and flooded it with traffic | OpenAI agents hacked an Australian government website in search for data |
| 90 | both | — | hacker, includ | Hackers suspected of using AI agents for cyberattacks on South Korean banks, exposing data from about 25,000 customers | Hackers steal 8 million citizens’ records from Danish government database |
| 91 | words | ai | agent, investigat | Hackers suspected of using AI agents for cyberattacks on South Korean banks, exposing data from about 25,000 customers | California subpoenas OpenAI over rogue AI agents conducting hacking attacks |
| 92 | words | ai | agent, hacker | Hackers suspected of using AI agents for cyberattacks on South Korean banks, exposing data from about 25,000 customers | AI agents hacked the hackers, stealing email addresses from security research org |
| 93 | words | ai | bank | Hackers suspected of using AI agents for cyberattacks on South Korean banks, exposing data from about 25,000 customers | AI is supercharging hacking, and your local hospitals and banks aren’t ready |
| 94 | words | ai | agent, hacker | Hackers suspected of using AI agents for cyberattacks on South Korean banks, exposing data from about 25,000 customers | 545 Hackers Tested It First. Now XRanges for AI Scores Your Security Agent |
| 95 | entity | — | australian, hack, openai | OpenAI admits response to Australian government hacks 'not good enough' | OpenAI must explain action taken to stop AI hacking Australians’ private data, chair of federal inquiry says |
| 96 | words | openai | hack, openai | OpenAI admits response to Australian government hacks 'not good enough' | California subpoenas OpenAI over rogue AI agents conducting hacking attacks |
| 97 | both | — | openai | OpenAI admits response to Australian government hacks 'not good enough' | OpenAI alerts 100+ orgs that its 'misaligned models' attempted to break in - or worse |
| 98 | entity | — | government, hack, openai | OpenAI admits response to Australian government hacks 'not good enough' | OpenAI disclose another hack on government department in Australia |
| 99 | words | openai | hack, openai | OpenAI admits response to Australian government hacks 'not good enough' | Lawsuit demands OpenAI halt unsafe development that caused Hugging Face hack |
| 100 | words | openai | hack, openai | OpenAI admits response to Australian government hacks 'not good enough' | Anthropic will not appear at Senate inquiry into AI and datacentres amid fallout from OpenAI hack |
| 101 | words | openai | hack, openai | OpenAI admits response to Australian government hacks 'not good enough' | Why Australia chose the world's biggest political stage to reveal OpenAI hack |
| 102 | entity | — | hack, inquiry, openai | OpenAI to reiterate apology to Australia over Medicare hack as inquiry told artists risk becoming ‘roadkill’ | OpenAI must explain action taken to stop AI hacking Australians’ private data, chair of federal inquiry says |
| 103 | words | microsoft | account, microsoft | Open Microsoft database with 17 trillion total rows and 25,000 user accounts hacked by a bored teenager — but he's been well-paid for his actions | Hackers hijacked Microsoft's X account for a scam featuring everyone's least-favorite tech mascot Clippy |
| 104 | words | microsoft | account, microsoft | Hackers hijacked Microsoft's X account for a scam featuring everyone's least-favorite tech mascot Clippy | Teenager hacks open Microsoft database with 17 trillion total rows and 25,000 user accounts |
| 105 | both | — | hacker, said | Hackers steal 8 million citizens’ records from Danish government database | Bitget Says Suspected North Korean Hackers Stole $351.6M After Backend Compromise |
| 106 | entity | — | australian, hack, openai | OpenAI must explain action taken to stop AI hacking Australians’ private data, chair of federal inquiry says | OpenAI says its review into hacks, including on Australian government sites, is costing $500,000 a day |
| 107 | entity | — | australian, hack, openai | OpenAI must explain action taken to stop AI hacking Australians’ private data, chair of federal inquiry says | OpenAI hack on Australian government reveals anxiety at heart of global artificial intelligence dilemma |
| 108 | entity | — | australian, hack, openai | OpenAI must explain action taken to stop AI hacking Australians’ private data, chair of federal inquiry says | OpenAI agents hacked an Australian government website in search for data |
| 109 | entity | — | hack, learn, reward | Beyond Reward Hacking: Proxy Divergence Across Four Layers of a Staged Humanoid Learning Pipeline | Greed Is Learned: Visible Incentives as Reward-Hacking Triggers |
| 110 | both | — | hack | Beyond Reward Hacking: Proxy Divergence Across Four Layers of a Staged Humanoid Learning Pipeline | Hacking group ShinyHunters claims it breached the FBI, stole agents’ and applicants’ data |
| 111 | both | — | campaign | Iranian national extradited to US over alleged $3.4 billion state-backed hacking campaign in rare legal win for law enforcement | Crook used three open source agents to break into a Fortune 500 hospitality company, a major US airline and 25+ other orgs |
| 112 | words | ai | agent, hack | California subpoenas OpenAI over rogue AI agents conducting hacking attacks | AI agents hacked the hackers, stealing email addresses from security research org |
| 113 | words | openai | hack, openai | California subpoenas OpenAI over rogue AI agents conducting hacking attacks | Lawsuit demands OpenAI halt unsafe development that caused Hugging Face hack |
| 114 | words | ai | hack | California subpoenas OpenAI over rogue AI agents conducting hacking attacks | AI is supercharging hacking, and your local hospitals and banks aren’t ready |
| 115 | words | ai | agent, hack | California subpoenas OpenAI over rogue AI agents conducting hacking attacks | ⚡ Weekly Recap: $387M Crypto Hack, Citrix Exploits, AI Agents Go Off-Script, and More Threats |
| 116 | words | ai, openai | hack, openai | California subpoenas OpenAI over rogue AI agents conducting hacking attacks | Anthropic will not appear at Senate inquiry into AI and datacentres amid fallout from OpenAI hack |
| 117 | words | openai | hack, openai | California subpoenas OpenAI over rogue AI agents conducting hacking attacks | Why Australia chose the world's biggest political stage to reveal OpenAI hack |
| 118 | words | openai | hack, openai | California subpoenas OpenAI over rogue AI agents conducting hacking attacks | Why did an OpenAI system hack Australia's health system - and can it be stopped in the future? |
| 119 | entity | — | government, hack, openai | OpenAI says its review into hacks, including on Australian government sites, is costing $500,000 a day | OpenAI disclose another hack on government department in Australia |
| 120 | entity | — | government, hack, openai | OpenAI disclose another hack on government department in Australia | OpenAI hack on Australian government reveals anxiety at heart of global artificial intelligence dilemma |
| 121 | entity | — | government, hack, openai | OpenAI disclose another hack on government department in Australia | OpenAI agents hacked an Australian government website in search for data |
| 122 | words | police | police | Met Police suspends use of phone-hacking software over Russian links | Dutch Police Arrest ‘Reformed’ Hacker in Shiny Hunters Investigation |
| 123 | entity | — | australia, hack, live | Australia news live: Julie Inman-Grant says ‘time for new leadership’ at eSafety; Ayres defends ‘cooperation’ with OpenAI after hack | Australia news live: Paterson says PM’s AI hack timing not a coincidence; gen Z going without for a house |
| 124 | words | openai | hack, openai | Australia news live: Julie Inman-Grant says ‘time for new leadership’ at eSafety; Ayres defends ‘cooperation’ with OpenAI after hack | OpenAI agents hacked an Australian government website in search for data |
| 125 | entity | — | agent, hacker, security | AI agents hacked the hackers, stealing email addresses from security research org | 545 Hackers Tested It First. Now XRanges for AI Scores Your Security Agent |
| 126 | words | fbi | fbi, hack | Passengers recount chaos on Tel Aviv flight. And, FBI probes employee-data hack | Inside the FBI hack: Agents fearful and angry after 'dangerous' data breach |
| 127 | words | fbi | fbi, hack | Passengers recount chaos on Tel Aviv flight. And, FBI probes employee-data hack | Special agents' blood and urine test results stolen in FBI hack |
| 128 | words | fbi | fbi, hack | Passengers recount chaos on Tel Aviv flight. And, FBI probes employee-data hack | FBI rushes to investigate if ShinyHunters hack of thousands of employees is real |
| 129 | words | fbi | fbi, hack | Passengers recount chaos on Tel Aviv flight. And, FBI probes employee-data hack | Hacking group ShinyHunters claims it breached the FBI, stole agents’ and applicants’ data |
| 130 | words | fbi | fbi, hack | Passengers recount chaos on Tel Aviv flight. And, FBI probes employee-data hack | ShinyHunters claims FBI hack: 'This is NOT financially motivated' |
| 131 | words | openai | hack, openai | Lawsuit demands OpenAI halt unsafe development that caused Hugging Face hack | ‘New kind of cyber incident’: OpenAI apologises for Medicare hack and reveals extent of attack |
| 132 | words | openai | hack, openai | Lawsuit demands OpenAI halt unsafe development that caused Hugging Face hack | Anthropic will not appear at Senate inquiry into AI and datacentres amid fallout from OpenAI hack |
| 133 | words | openai | hack, openai | Lawsuit demands OpenAI halt unsafe development that caused Hugging Face hack | Why Australia chose the world's biggest political stage to reveal OpenAI hack |
| 134 | words | openai | hack, openai | Lawsuit demands OpenAI halt unsafe development that caused Hugging Face hack | Australia to investigate if OpenAI hack of government health website broke the law |
| 135 | words | openai | hack, openai | Lawsuit demands OpenAI halt unsafe development that caused Hugging Face hack | Anthony Albanese says OpenAI agent hacked Medicare and he expressed ‘extreme concern’ to Sam Altman |
| 136 | words | openai | hack, openai | Here's what actually happened in OpenAI's Australian gov't server hack | Why Australia chose the world's biggest political stage to reveal OpenAI hack |
| 137 | words | openai | hack, openai | Here's what actually happened in OpenAI's Australian gov't server hack | Why did an OpenAI system hack Australia's health system - and can it be stopped in the future? |
| 138 | words | shinyhunters | hacker, shinyhunter | Dutch police arrest ShinyHunters hacker accused of planning two murders | FBI rushes to investigate if ShinyHunters hack of thousands of employees is real |
| 139 | words | shinyhunters | said, shinyhunter | Dutch police arrest ShinyHunters hacker accused of planning two murders | ShinyHunters claims FBI hack: 'This is NOT financially motivated' |
| 140 | words | fbi | cyber, fbi | Dutch police arrest suspected member of group that claimed FBI hack | FBI reportedly declares ‘cyber security incident’ after hackers steal agents’ personal data |
| 141 | words | fbi | fbi, hack | Dutch police arrest suspected member of group that claimed FBI hack | Inside the FBI hack: Agents fearful and angry after 'dangerous' data breach |
| 142 | words | fbi | fbi, hack | Dutch police arrest suspected member of group that claimed FBI hack | ShinyHunters tells The Reg: We hacked the FBI to 'protect our business' |
| 143 | words | openai | hack, openai | ‘New kind of cyber incident’: OpenAI apologises for Medicare hack and reveals extent of attack | Anthropic will not appear at Senate inquiry into AI and datacentres amid fallout from OpenAI hack |
| 144 | words | medicare | hack, medicare | ‘New kind of cyber incident’: OpenAI apologises for Medicare hack and reveals extent of attack | AI hack of Medicare exposes Australia’s vulnerabilities and experts warn ‘there is more of this to come’ |
| 145 | words | openai | hack, openai | ‘New kind of cyber incident’: OpenAI apologises for Medicare hack and reveals extent of attack | Why did an OpenAI system hack Australia's health system - and can it be stopped in the future? |
| 146 | words | openai | hack, openai | ‘New kind of cyber incident’: OpenAI apologises for Medicare hack and reveals extent of attack | OpenAI agents hacked an Australian government website in search for data |
| 147 | entity | — | hacker, malware, microsoft | Hackers Use NeedyMantis to Maintain Long-Term Access in Breached Networks | Chinese Hackers Exploit Chrome-Windows Zero-Day Chain to Deploy CLEANGULP Malware |
| 148 | words | fbi | agent, fbi | FBI reportedly declares ‘cyber security incident’ after hackers steal agents’ personal data | Special agents' blood and urine test results stolen in FBI hack |
| 149 | entity | — | fbi, hacker, personal | FBI reportedly declares ‘cyber security incident’ after hackers steal agents’ personal data | FBI rushes to investigate if ShinyHunters hack of thousands of employees is real |
| 150 | words | agents | agent, hack | ⚡ Weekly Recap: $387M Crypto Hack, Citrix Exploits, AI Agents Go Off-Script, and More Threats | Inside the FBI hack: Agents fearful and angry after 'dangerous' data breach |
| 151 | entity | — | bitget, crypto, exchange, hack, north, suspect | North Korea named as primary suspect in $387 million Bitget crypto hack | North Korean hackers suspected in $351M crypto theft, the largest so far this year |
| 152 | words | openai | hack, openai | Anthropic will not appear at Senate inquiry into AI and datacentres amid fallout from OpenAI hack | Why Australia chose the world's biggest political stage to reveal OpenAI hack |
| 153 | words | openai | hack, openai | Anthropic will not appear at Senate inquiry into AI and datacentres amid fallout from OpenAI hack | Why did an OpenAI system hack Australia's health system - and can it be stopped in the future? |
| 154 | words | openai | hack, openai | Anthropic will not appear at Senate inquiry into AI and datacentres amid fallout from OpenAI hack | Australia to investigate if OpenAI hack of government health website broke the law |
| 155 | words | openai | hack, openai | Anthropic will not appear at Senate inquiry into AI and datacentres amid fallout from OpenAI hack | Anthony Albanese says OpenAI agent hacked Medicare and he expressed ‘extreme concern’ to Sam Altman |
| 156 | words | fbi | fbi, hack | ShinyHunters tells The Reg: We hacked the FBI to 'protect our business' | Special agents' blood and urine test results stolen in FBI hack |
| 157 | entity | — | actor, hacker, threat | Bitget Says Suspected North Korean Hackers Stole $351.6M After Backend Compromise | Chinese Hackers Exploit Chrome-Windows Zero-Day Chain to Deploy CLEANGULP Malware |
| 158 | both | — | agent, test | PartHackBench: Certified Equal-Progress Stress Tests for Partial-Credit Tool-Agent Evaluation | 545 Hackers Tested It First. Now XRanges for AI Scores Your Security Agent |
| 159 | words | australia | australia, hack | Why Australia chose the world's biggest political stage to reveal OpenAI hack | AI hack of Medicare exposes Australia’s vulnerabilities and experts warn ‘there is more of this to come’ |
| 160 | words | australia | australia, hack | AI hack of Medicare exposes Australia’s vulnerabilities and experts warn ‘there is more of this to come’ | Why did an OpenAI system hack Australia's health system - and can it be stopped in the future? |
| 161 | words | australia | australia, hack | AI hack of Medicare exposes Australia’s vulnerabilities and experts warn ‘there is more of this to come’ | Australia to investigate if OpenAI hack of government health website broke the law |
| 162 | words | medicare | hack, medicare | AI hack of Medicare exposes Australia’s vulnerabilities and experts warn ‘there is more of this to come’ | Anthony Albanese says OpenAI agent hacked Medicare and he expressed ‘extreme concern’ to Sam Altman |
| 163 | words | openai | hack, openai | Why did an OpenAI system hack Australia's health system - and can it be stopped in the future? | Anthony Albanese says OpenAI agent hacked Medicare and he expressed ‘extreme concern’ to Sam Altman |
| 164 | entity | — | claim, fbi, hacker, investigat, jobs, stolen, website | FBI rushes to investigate if ShinyHunters hack of thousands of employees is real | FBI investigates breach of jobs website as hackers claim ‘very sensitive data’ stolen |
