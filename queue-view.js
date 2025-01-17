/*
*Copyright 2015 Kyle Haefner
*
* This program is free software: you can redistribute it and/or modify
*it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.

**/


//#!/usr/bin/env node
var express = require('express');
var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var esl = require('modesl');

//static content
app.use(express.static(__dirname + '/public'));

debug = 'false';

//Sync
currentQueue = 0;

//Globals
var queueArray = new Array();
var queueCount = 0;
var queueState = "";
var errorArray = new Array();
var agentArray = new Array();
var memberArray = new Array();
var callArray = new Array();
var openSocket;


//Objects
function Queue(name) {
    this.name = name;
    this.totalCalls = 0;
    this.activeCalls = 0;
    this.answeredCalls = 0;
    this.agentsInCall = 0;
    this.abandonedCalls = 0;
    this.abandonedTime = 0;
    this.longestWait = 0;
    this.totalAgents = 0;
    this.onBreakAgents = 0;
    this.loggedInAgents = 0;
    this.availableAgents = 0;
}


function Agent(queue, name, status, state, offered_number, offered_name, no_answer_count, calls_answered, talk_time) {
    this.queue = queue;
    this.name = name;
    this.status = status;
    this.state = state;
    this.no_answer_count = no_answer_count;
    this.calls_answered = calls_answered;
    this.talk_time = talk_time;
    this.offered_name = (typeof (offered_name) === 'undefined') ? 'Anonymous' : offered_name;
    this.offered_number = (typeof (offered_number) === 'undefined') ? '0000000000' : offered_number;
}

function Member(uuid, name, number, agent, agent_uuid, queue, state, call_start, call_join, call_end, termination_cause) {
    this.uuid = uuid;
    this.name = (typeof (name) === 'undefined') ? 'Anonymous' : name;
    this.number = (typeof (number) === 'undefined') ? '0000000000' : number;
    this.agent = (typeof (agent) === 'undefined') ? 'Undefined' : agent;
    this.agent_uuid = (typeof (agent_uuid) === 'undefined') ? 'Undefined' : agent_uuid;
    this.queue = (typeof (queue) === 'undefined') ? 'Undefined' : queue;
    this.state = (typeof (state) === 'undefined') ? 'Undefined' : state;
    this.call_start = (typeof (call_start) === 'undefined') ? 'Undefined' : call_start;
    this.call_join = (typeof (call_join) === 'undefined') ? 'Undefined' : call_join;
    this.call_end = (typeof (call_end) === 'undefined') ? 'Undefined' : call_end;
    this.termination_cause = (typeof (termination_cause) === 'undefined') ? 'Undefined' : termination_cause;
}



//Send html file
app.get('/', function (req, res) {
    //res.sendFile('index.html');
    res.sendFile('index.html', { root: __dirname });
});

http.listen(3000, function () {
    console.log('listening on *:3000');
});

//Polls Freeswitch for number and names of queues
function getQueues() {
    queueLine = Array()
    conn.api('callcenter_config queue list', function (res) {
        var queueList = res.getBody().split("\n");
        for (var q = 0; q < queueList.length; q++) {
            if (queueList[q].match(/^(?!name|\+OK)/)) {
                if (queueList[q].length) {
                    queueLine.push(queueList[q]);
                }
            }

        }
        if (queueLine.length < 1) {
            error = "No Queues Configured";
            errorArray.push(error);
        } else {
            queueCount = (queueLine.length);
            if (debug == 'true') {
                console.log("Number of queues:" + queueCount);
            }
            for (var i = 0; i < queueCount; i++) {
                var queueName = queueList[i + 1].split("|")[0];
                var queue = new Queue(queueName);
                queueArray.push(queue);
            }
        }
    });
}

function queueStats(event) {
    //console.log(JSON.stringify(event));
    for (var q = 0; q < queueArray.length; q++) {
        queueArray[q].loggedInAgents = 0;
        queueArray[q].totalAgents = 0;
        queueArray[q].availableAgents = 0;
        queueArray[q].agentsInCall = 0;
        queueArray[q].onBreakAgents = 0;
        if (queueArray[q].name == event['CC-Queue']) {
            if (event['CC-Action'] == 'member-queue-start') {
                queueArray[q].totalCalls++;
                queueArray[q].activeCalls++;
                /*var member = ev['CC-Member-UUID'];
                if(typeof member != 'undefined'){
                var isInQueue = callArray.indexOf(event['CC-Member-UUID']);
                if(isInQueue < 0){ //not in array
                callArray.unshift(ev['CC-Member-UUID']);
                queueArray[q].totalCalls++;
                queueArray[q].activeCalls++;
                }
                }
                */
            }
            if (event['CC-Action'] == 'member-queue-end') {
                //callArray.splice(isInQueue,1);
                if (queueArray[q].activeCalls >= 1) {
                    queueArray[q].activeCalls--;
                    joinTime = event['CC-Member-Joined-Time'];
                    answerTime = event['CC-Agent-Answered-Time'];
                    if (answerTime > 0) {
                        waitTime = answerTime - joinTime;
                        if (queueArray[q].longestWait < waitTime) {
                            queueArray[q].longestWait = waitTime;
                        }
                    }
                }
            }
            if (event['CC-Action'] == 'bridge-agent-start') {
                queueArray[q].agentInCall++;
                queueArray[q].answeredCalls++;
            }
            if (event['CC-Action'] == 'bridge-agent-end') {
                if (queueArray[q].agentInCall >= 1) {
                    queueArray[q].agentInCall--;
                }
            }
            if (event['CC-Cancel-Reason'] == "BREAK_OUT") {
                queueArray[q].abandonedCalls++;
                joinTime = event['CC-Member-Joined-Time'];
                leaveTime = event['CC-Member-Leaving-Time'];
                abandonTime = leaveTime - joinTime;
                if (queueArray[q].abandonedTime < abandonTime) {
                    queueArray[q].abandonedTime = abandonTime;
                }
            }
        }
        //Begin Agents Stat Collection
        for (var a = 0; a < agentArray.length; a++) {
            if (agentArray[a].queue == queueArray[q].name) {
                queueArray[q].totalAgents++;
                if (agentArray[a].status == "Available") {
                    queueArray[q].loggedInAgents++;
                    if (agentArray[a].state == "Waiting") {
                        queueArray[q].availableAgents++;
                    }
                    if (agentArray[a].state == "In a queue call") {
                        queueArray[q].agentsInCall++;
                    }
                }
                if (agentArray[a].status == "Logged Out") {
                    if (queueArray[q].loggedInAgents >= 1) {
                        queueArray[q].loggedInAgents--;
                    }
                    if (queueArray[q].availableAgents >= 1) {
                        queueArray[q].availableAgents--;
                    } else {
                        queueArray[q].availableAgents = 0;
                    }
                }
                if (agentArray[a].status == "On Break") {
                    queueArray[q].onBreakAgents++;
                    queueArray[q].loggedInAgents++;
                    if (queueArray[q].availableAgents >= 1) {
                        queueArray[q].availableAgents--;
                    } else {
                        queueArray[q].availableAgents = 0;
                    }
                }
            }
        }
    }
    if (debug == 'true') {
        //console.log(JSON.stringify(queueArray));
    }
}



function waitForAgents() {
    if (agentSync == queueArray.length && agentSync != 0) {
        console.log("Agents are synced");
        console.log(queueArray);
        return;
    } else {
        setTimeout(waitForAgents, 1000);
    }
}


//Polls Freeswitch for the number and names of agents
function getAgents() {
    //wait for getQueue to complete...asyncronous!
    if (queueArray.length < 1) {
        setTimeout(getAgents, 1000);
    }
    for (var a = 0; a < queueArray.length; a++) {
        console.log(queueArray[a].name);
        var queueName = queueArray[a].name;
        var agentList;
        conn.api('callcenter_config queue list agents ' + queueName, function (res) {
            agentList = res.getBody().split("\n");
            for (var m = 1; m < agentList.length - 2; m++) {
                agentLine = agentList[m];
                agentLineArray = agentLine.split("|");
                agent = new Agent();
                agent.queue = queueArray[currentQueue].name;
                agent.name = agentLineArray[0];
                agent.status = agentLineArray[5];
                agent.state = agentLineArray[6];
                agent.no_answer_count = agentLineArray[16];
                agent.calls_answered = agentLineArray[17];
                agent.talk_time = agentLineArray[18];
                agentArray.push(agent);
                if (debug == 'true') {
                    console.log("Agent:" + agent.name + "|State:" + agent.state + "|Status:" + agent.status + "|NoAnswerCount:" + agent.no_answer_count + "|Calls_Answered:" + agent.calls_answered + "|Talk_Time:" + agent.talk_time + "|Queue:" + agent.queue);
                }
            }
            currentQueue++;
        });
    }
}


function handleMemberQueueStart(event) {
    var member = new Member();
    member.uuid = event['CC-Member-UUID'];
    member.name = event['CC-Member-CID-Name'];
    member.number = event['CC-Member-CID-Number'];
    member.call_start = event['Event-Date-Timestamp'];
    member.queue = event['CC-Queue'];
    member.state = "Active";
    var uuidMatch = "";
    for (var m = 0; m < memberArray.length; m++) {
        if (memberArray[m].uuid == member.uuid) {
            uuidMatch = "matched";
        }
    }
    if (!uuidMatch) {
        memberArray.unshift(member);
    }
}

function handleMemberQueueUpdate(event) {
    for (var m = 0; m < memberArray.length; m++) {
        if (memberArray[m].uuid == event['CC-Member-UUID']) {
            if (event['CC-Cause'] == "Terminated" || event['CC-Cause'] == "Cancel") {
                memberArray[m].state = "Inactive";
            }
            if (event['CC-Action'] == "bridge-agent-start") {
                memberArray[m].call_join = event['CC-Member-Joined-Time'];
                memberArray[m].state = "Bridged";
                memberArray[m].agent = event['CC-Agent'];
            }
        }
    }
}

function handleMemberQueueStop(event) {
    for (var m = 0; m < memberArray.length; m++) {
        if (memberArray[m].uuid == event['CC-Member-UUID']) {
            memberArray.splice(m, 1);
        }
    }
}


function handleAgentStatus(event) {
    for (var a = 0; a < agentArray.length; a++) {
        if (agentArray[a].name == event['CC-Agent']) {
            agentArray[a].status = event['CC-Agent-Status'];
            if (debug == 'true') {
                console.log("Agent Status Updating:" + agentArray[a].name + " Status:" + agentArray[a].status);
            }
        }
    }
}

function handleAgentState(event) {
    for (var a = 0; a < agentArray.length; a++) {
        if (agentArray[a].name == event['CC-Agent']) {
            agentArray[a].state = event['CC-Agent-State'];
            if (debug == 'true') {
                console.log("Agent State Updating:" + agentArray[a].name + " Status:" + agentArray[a].state);
            }
        }
    }
    //console.log(stateEvent);
}
function handleAgentOffering(event) {
    for (var a = 0; a < agentArray.length; a++) {
        if (agentArray[a].name == event['CC-Agent']) {
            agentArray[a].offered_number = event['CC-Member-CID-Number'];
            agentArray[a].offered_name = event['CC-Member-CID-Name'];
            if (debug == 'true') {
                console.log("Agent:" + agentArray[a].name + " Offered:" + agentArray[a].offered_name + " " + agentArray[a].offered_number);
            }
        }
    }
}

function getAgentStatus(queueName) {
    conn.api('callcenter_config queue list agents ' + queueName, function (res) {
        //log result body and exit
        queueState = res.getBody().split("\n")[1];
        console.log(queueState);
    });
}
function getMemberStatus(queueName) {
    memberArray = new Array();
    conn.api('callcenter_config queue list members ' + queueName, function (res) {
        memberList = res.getBody().split("\n");
        if (memberList.length < 4) {
            return memberArray;
        } else {
            for (var m = 1; m < memberList.length - 2; m++) {
                memberLine = memberList[m];
                memberLineArray = memberLine.split("|");
                member = new Member();
                member.queue = memberLineArray[0];
                member.name = memberLineArray[4];
                member.number = memberLineArray[5];
                member.agent = memberLineArray[13];
                member.state = memberLineArray[15];
                member.call_start = memberLineArray[7];
                member.call_join = memberLineArray[9];
                if (debug == 'true') {
                    console.log("Queue:" + member.queue + "|State:" + member.state + "|Agent:" + member.agent + "|Name:" + member.name + "|Number:" + member.number + "|Call Start:" + member.call_start + "|Call Join:" + member.call_join);
                }
            }
            //console.log(queueName+" "+res.getBody());
        }
    });
}


if (debug == 'true') {
    console.log("Debugging enabled");
}


function initClients() {
    io.on('connection', function (socket) {
        socket.emit('agentFill', agentArray);
        socket.emit('queueFill', queueArray);
        socket.emit('queueStats', queueArray);
    });

}


function sendToClients() {
    io.sockets.emit('queueStats', queueArray);
    io.sockets.emit('memberUpdate', memberArray);
    io.sockets.emit('memberStart', memberArray);
    io.sockets.emit('agentStatusUpdate', agentArray);
    io.sockets.emit('agentStateUpdate', agentArray);
    io.sockets.emit('agentOffering', agentArray);
}



//open a connection
conn = new esl.Connection('127.0.0.1', 8021, 'ClueCon', function () {
    getQueues();
    getAgents();
    initClients();
    conn.events("plain", "all");
    conn.on('**', function (e) {
        name = e.getHeader('Event-Name');
        if (name == 'CUSTOM') {
            subclass = e.getHeader("Event-Subclass");
            if (subclass == 'callcenter::info') {
                json = e.serialize('json');
                ev = JSON.parse(json);
                cc_Action = ev["CC-Action"];
                switch (cc_Action) {
                    case "members-count":
                        break;
                    case "member-queue-start":
                        handleMemberQueueStart(ev);
                        break;
                    case "member-queue-end":
                        handleMemberQueueStop(ev);
                        break;
                    case "member-queue-join":
                        break;
                    case "agent-status-change":
                        handleAgentStatus(ev);
                        break;
                    case "agent-state-change":
                        handleAgentState(ev);
                        break;
                    case "agent-offering":
                        handleAgentOffering(ev);
                        break;
                    case "bridge-agent-start":
                        handleMemberQueueUpdate(ev);
                        break;
                    case "bridge-agent-end":
                        break;
                    case "bridge-agent-fail":
                        break;
                    default:
                        console.log("Unhandled Action:" + cc_Action);
                        console.log(json);
                }
                //console.log(json);
                queueStats(ev);
                sendToClients();
            }
        }
    });
});

