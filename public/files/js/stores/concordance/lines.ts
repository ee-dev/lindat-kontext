/*
 * Copyright (c) 2016 Charles University in Prague, Faculty of Arts,
 *                    Institute of the Czech National Corpus
 * Copyright (c) 2016 Tomas Machalek <tomas.machalek@gmail.com>
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; version 2
 * dated June, 1991.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.

 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 */

/// <reference path="../../types/common.d.ts" />
/// <reference path="../../types/ajaxResponses.d.ts" />
/// <reference path="../../../ts/declarations/flux.d.ts" />
/// <reference path="../../../ts/declarations/rsvp.d.ts" />
/// <reference path="../../../ts/declarations/immutable.d.ts" />
/// <reference path="../../../ts/declarations/modernizr.d.ts" />
/// <reference path="../../../ts/declarations/soundmanager.d.ts" />

import {SimplePageStore, MultiDict} from '../../util';
import {PageModel} from '../../tpl/document';
import Immutable = require('vendor/immutable');
import {Line, LangSection, KWICSection, TextChunk} from './line';
import SoundManager = require('SoundManager');
import RSVP = require('vendor/rsvp');
declare var Modernizr:Modernizr.ModernizrStatic;

export interface ServerTextChunk {
    class:string;
    str:string;
    open_link?:{speech_path:string};
    close_link?:{speech_path:string};
    continued?:boolean;
    mouseover?:Array<string>;
}

export interface ServerPagination {
    firstPage:number;
    prevPage:number;
    nextPage:number;
    lastPage:number;
}

export interface SingleCorpServerLineData {
    Left:Array<ServerTextChunk>;
    Right:Array<ServerTextChunk>;
    Kwic:Array<ServerTextChunk>;
    rightsize:number;
    hitlen:string;
    linegroup:string;
    leftsize:number;
    ref:string;
    rightspace:string;
    linenum:number;
    leftspace:string;
    kwiclen:number;
    toknum:number;
}

export interface ServerLineData extends SingleCorpServerLineData {
    Align:Array<SingleCorpServerLineData>;
}

export interface ConcSummary {
    concSize: number;
    fullSize: number;
    sampledSize: number;
    ipm: number;
    arf: number;
    isShuffled: boolean;
}

export interface ViewConfiguration {

    /**
     * Determine concordance view mode (kwic/sen/align)
     */
    ViewMode:string;

    ShowLineNumbers:boolean;

    KWICCorps:Array<string>;

    CorporaColumns:Array<{n:string; label:string}>;

    WideCtxGlobals:Array<Array<string>>;

    SortIdx:Array<{page:number; label:string}>;

    NumItemsInLockedGroups:number;

    baseCorpname:string;

    mainCorp:string;

    subCorpName:string;

    pagination:ServerPagination;

    currentPage:number;

    concSummary:ConcSummary;

    canSendEmail:boolean;

    /**
     * If true then client regularly fetches status
     * of the calculation until it is finished.
     */
    Unfinished:boolean;

    /**
     * A flag specifying whether the client should
     * offer an on-demand calculation of i.p.m.
     * in case Manatee provides results related to
     * a whole corpus while user wants to see
     * a result related to his ad-hoc corpus.
     */
    ContainsWithin:boolean;

    /**
     * If true then a concordance toolbar providing
     * some useful options is shown.
     */
    ShowConcToolbar:boolean;

    onReady?:()=>void;

    onPageUpdate?:()=>void;

    onChartFrameReady?:(usePrevData:boolean)=>void;
}

/**
 *
 */
function importData(data:Array<ServerLineData>):Immutable.List<Line> {
    let ans:Array<Line> = [];

    function importTextChunk(item:ServerTextChunk):TextChunk {
        return {
            className: item.class,
            text: item.str,
            openLink: item.open_link ? {speechPath: item.open_link.speech_path} : undefined,
            closeLink: item.close_link ? {speechPath: item.close_link.speech_path} : undefined,
            continued: item.continued,
            showAudioPlayer: false,
            mouseover: item.mouseover || []
        };
    }

    data.forEach((item:ServerLineData) => {
        let line:Array<KWICSection> = [];

        line.push(new KWICSection(
            item.toknum,
            item.linenum,
            item.ref,
            Immutable.List<TextChunk>(item.Left.map(importTextChunk)),
            Immutable.List<TextChunk>(item.Kwic.map(importTextChunk)),
            Immutable.List<TextChunk>(item.Right.map(importTextChunk))
        ));

        line = line.concat((item.Align || []).map((item) => {
            return new KWICSection(
                item.toknum,
                item.linenum,
                item.ref,
                Immutable.List<TextChunk>(item.Left.map(importTextChunk)),
                Immutable.List<TextChunk>(item.Kwic.map(importTextChunk)),
                Immutable.List<TextChunk>(item.Right.map(importTextChunk))
            );
        }));

        let ansItem:Line = new Line();
        ansItem.lineNumber = item.linenum;
        ansItem.lineGroup = item.linegroup;
        ansItem.kwicLength = item.kwiclen;
        ansItem.languages = Immutable.List(line);
        ans.push(ansItem); // TODO
    });

    return Immutable.List(ans);
}


/**
 *
 */
class AudioPlayer {

    static PLAYER_STATUS_STOPPED = 0;

    static PLAYER_STATUS_PAUSED = 1;

    static PLAYER_STATUS_PLAYING = 2;

    private soundManager:SoundManager.SoundManager;

    private status:number;

    private playSessionId:string = 'kontext-playback';

    private itemsToPlay:Immutable.List<string>;

    private onStop:()=>void;

    private onPlay:()=>void;

    private onError:()=>void;

    constructor(sm2FilesURL:string, onPlay:()=>void, onStop:()=>void, onError:()=>void) {
        this.status = AudioPlayer.PLAYER_STATUS_STOPPED;
        this.soundManager = SoundManager.getInstance();
        this.soundManager.ontimeout = function (status) {
            console.error(status); // TODO
        }
        this.soundManager.setup({
            url: sm2FilesURL,
            flashVersion: 9,
            debugMode : false,
            preferFlash : false
        });
        this.itemsToPlay = Immutable.List([]);
        this.onPlay = onPlay;
        this.onStop = onStop;
        this.onError = onError;
    }

    start(itemsToPlay?:Array<string>):void {
        const self = this;

        if (itemsToPlay) {
            this.itemsToPlay = this.itemsToPlay.concat(Immutable.List<string>(itemsToPlay)).toList();
        }
        let sound = this.soundManager.createSound({
            id: this.playSessionId,
            url: this.itemsToPlay.first(),
            autoLoad: true,
            autoPlay: false,
            volume: 100,
            onload: (bSuccess) => {
                if (!bSuccess) {
                    self.onError();
                }
            },
            onplay: function () {
                self.status = AudioPlayer.PLAYER_STATUS_PLAYING;
                self.onPlay();
            },
            onfinish: function () {
                self.status = AudioPlayer.PLAYER_STATUS_STOPPED;
                self.soundManager.destroySound(self.playSessionId);
                if (self.itemsToPlay.size > 0) {
                    self.soundManager.destroySound(self.playSessionId); // TODO do we need this (again)?
                    self.start();

                } else {
                    self.onStop();
                }
            }
        });
        this.itemsToPlay = this.itemsToPlay.shift();
        sound.play();
    }

    play():void {
        if (this.status === AudioPlayer.PLAYER_STATUS_STOPPED) {
            this.soundManager.play(this.playSessionId);
            this.status = AudioPlayer.PLAYER_STATUS_PLAYING;

        } else if (this.status === AudioPlayer.PLAYER_STATUS_PAUSED) {
            this.soundManager.play(this.playSessionId);
            this.status = AudioPlayer.PLAYER_STATUS_PLAYING;
        }
    }

    pause():void {
        if (this.status === AudioPlayer.PLAYER_STATUS_PAUSED) {
            this.soundManager.play(this.playSessionId);
            this.status = AudioPlayer.PLAYER_STATUS_PLAYING;

        } else if (this.status === AudioPlayer.PLAYER_STATUS_PLAYING) {
            this.soundManager.pause(this.playSessionId);
            this.status = AudioPlayer.PLAYER_STATUS_PAUSED;
        }
    }

    stop():void {
        this.soundManager.stop(this.playSessionId);
        this.soundManager.destroySound(this.playSessionId);
        this.itemsToPlay = this.itemsToPlay.clear();
    }

    getStatus():number {
        return this.status;
    }
}

/**
 *
 */
export class ConcLineStore extends SimplePageStore {

    private layoutModel:PageModel;

    private lines:Immutable.List<Line>;

    private viewMode:string;

    private showLineNumbers:boolean;

    private kwicCorps:Immutable.List<string>;

    private corporaColumns:Immutable.List<{n:string; label:string}>;

    private wideCtxGlobals:Array<Array<string>>;

    private baseCorpname:string;

    private subCorpName:string;

    private mainCorp:string;

    private audioPlayer:AudioPlayer;

    private playerAttachedChunk:TextChunk;

    private pagination:ServerPagination;

    private currentPage:number;

    private focusedLine:number;

    private numItemsInLockedGroups:number;

    private unfinishedCalculation:boolean;

    private concSummary:ConcSummary;

    private externalRefsDetailFn:(corpusId:string, tokenNum:number, lineIdx:number)=>void;

    private externalKwicDetailFn:(corpusId:string, tokenNum:number, lineIdx:number)=>void;

    private containsWithin:boolean;

    private adHocIpm:number;


    constructor(layoutModel:PageModel, dispatcher:Dispatcher.Dispatcher<any>,
            lineViewProps:ViewConfiguration, initialData:Array<ServerLineData>) {
        super(dispatcher);
        let self = this;
        this.layoutModel = layoutModel;
        this.viewMode = lineViewProps.ViewMode;
        this.showLineNumbers = lineViewProps.ShowLineNumbers;
        this.kwicCorps = Immutable.List(lineViewProps.KWICCorps);
        this.corporaColumns = Immutable.List(lineViewProps.CorporaColumns);
        this.baseCorpname = lineViewProps.baseCorpname;
        this.subCorpName = lineViewProps.subCorpName;
        this.mainCorp = lineViewProps.mainCorp;
        this.unfinishedCalculation = lineViewProps.Unfinished;
        this.concSummary = lineViewProps.concSummary;
        this.lines = importData(initialData);
        this.numItemsInLockedGroups = lineViewProps.NumItemsInLockedGroups;
        this.pagination = lineViewProps.pagination; // TODO possible mutable mess
        this.currentPage = lineViewProps.currentPage || 1;
        this.containsWithin = lineViewProps.ContainsWithin;
        this.audioPlayer = new AudioPlayer(
            this.layoutModel.createStaticUrl('misc/soundmanager2/'),
            () => {
                self.notifyChangeListeners();
            },
            this.setStopStatus.bind(this),
            () => {
                self.audioPlayer.stop();
                self.setStopStatus();
                self.layoutModel.showMessage('error',
                        self.layoutModel.translate('concview__failed_to_play_audio'));
            }
        );

        this.dispatcher.register(function (payload:Kontext.DispatcherPayload) {
            switch (payload.actionType) {
                case 'CONCORDANCE_CHANGE_MAIN_CORPUS':
                    self.changeMainCorpus(payload.props['maincorp']);
                break;
                case 'CONCORDANCE_PLAY_AUDIO_SEGMENT':
                    self.playAudio(payload.props['lineIdx'], payload.props['chunks']);
                    self.notifyChangeListeners();
                break;
                case 'AUDIO_PLAYER_CLICK_CONTROL':
                    self.handlePlayerControls(payload.props['action']);
                    self.notifyChangeListeners();
                break;
                case 'CONCORDANCE_CHANGE_PAGE':
                case 'CONCORDANCE_REVISIT_PAGE':
                    let action = payload.props['action'];
                    self.changePage(payload.props['action'], payload.props['pageNum']).then(
                        (data) => {
                            if (payload.actionType === 'CONCORDANCE_CHANGE_PAGE') {
                                self.pushHistoryState(self.currentPage);
                            }
                            self.notifyChangeListeners();
                        },
                        (err) => {
                            self.notifyChangeListeners();
                            self.layoutModel.showMessage('error', err);
                        }
                    );
                break;
                case 'CONCORDANCE_RELOAD_PAGE':
                    self.reloadPage().then(
                        (data) => {
                            self.pushHistoryState(self.currentPage);
                            self.notifyChangeListeners();
                        },
                        (err) => {
                            self.layoutModel.showMessage('error', err);
                        }
                    );
                break;
                case 'CONCORDANCE_UPDATE_NUM_AVAIL_PAGES':
                    self.pagination.lastPage = payload.props['availPages'];
                    self.notifyChangeListeners();
                break;
                case 'CONCORDANCE_SHOW_REF_DETAIL':
                    if (typeof self.externalRefsDetailFn === 'function') {
                        self.externalRefsDetailFn(payload.props['corpusId'],
                                payload.props['tokenNumber'], payload.props['lineIdx']);
                    }
                break;
                case 'CONCORDANCE_SHOW_KWIC_DETAIL':
                    if (typeof self.externalKwicDetailFn === 'function') {
                        self.externalKwicDetailFn(payload.props['corpusId'],
                                payload.props['tokenNumber'], payload.props['lineIdx']);
                    }
                break;
                case 'CONCORDANCE_ASYNC_CALCULATION_UPDATED':
                    self.unfinishedCalculation = !payload.props['finished'];
                    self.concSummary.fullSize = payload.props['fullsize'];
                    self.concSummary.concSize = payload.props['concsize'];
                    self.notifyChangeListeners();
                break;
                case 'CONCORDANCE_CALCULATE_IPM_FOR_AD_HOC_SUBC':
                    self.calculateAdHocIpm().then(
                        (data) => {
                            self.notifyChangeListeners('$CONCORDANCE_CALCULATE_IPM_FOR_AD_HOC_SUBC');
                        },
                        (err) => {
                            console.error(err);
                            self.layoutModel.showMessage('error', self.layoutModel.translate('global__failed_to_calc_ipm'));
                        }
                    );
                break;
            }
        });
    }

    getViewAttrs():Array<string> {
        return (this.layoutModel.getConcArgs()['attrs'] || []).split(',');
    }

    getViewAttrsVmode():string {
        return this.layoutModel.getConcArgs()['attr_vmode'];
    }

    getNumItemsInLockedGroups():number {
        return this.numItemsInLockedGroups;
    }

    private pushHistoryState(pageNum:number):void {
        const args = this.layoutModel.getConcArgs();
        args.set('fromp', pageNum);
        this.layoutModel.history.pushState(
            'view', args, { pagination: true, pageNum: pageNum });
    }

    /**
     * Reload data on current concordance page.
     * The returned promise passes URL argument matching
     * currently displayed data page.
     */
    reloadPage(concId?:string):RSVP.Promise<MultiDict> {
        return this.changePage('customPage', this.currentPage, concId);
    }

    private pageIsInRange(num:number):boolean {
        return this.pagination.firstPage <= num && num <= this.pagination.lastPage;
    }

    private pageNumIsValid(num:number):boolean {
        return !isNaN(num) && Math.round(num) === num;
    }

    /**
     * Changes current data page - either by moving <--, <-, ->, --> or
     * by entering a specific page number.
     * The returned promise passes URL argument matching
     * currently displayed data page.
     */
    private changePage(action:string, pageNumber?:number, concId?:string):RSVP.Promise<MultiDict> {
        const args = this.layoutModel.getConcArgs();
        const pageNum:number = Number(action === 'customPage' ? pageNumber : this.pagination[action]);

        if (!this.pageNumIsValid(pageNum) || !this.pageIsInRange(pageNum)) {
            return new RSVP.Promise((resolve: (v: MultiDict)=>void, reject:(e:any)=>void) => {
                reject(new Error(this.layoutModel.translate('concview__invalid_page_num_err')));
            });
        }

        args.set('fromp', pageNum);
        args.set('format', 'json');
        if (concId) {
            args.set('q', concId);
        }
        let url = this.layoutModel.createActionUrl('view') + '?' +
                this.layoutModel.encodeURLParameters(args);
        let prom = this.layoutModel.ajax(
            'GET',
            url,
            {},
            {contentType : 'application/x-www-form-urlencoded'}

        ).then(
            (data:Kontext.AjaxResponse) => {
                try {
                    if (data.contains_errors) {
                        throw new Error(data.messages[0][1]);
                    }
                    this.lines = importData(data['Lines']);
                    this.numItemsInLockedGroups = data['num_lines_in_groups'];
                    this.pagination = data['pagination'];
                    this.currentPage = pageNum;
                    this.unfinishedCalculation = data['running_calc'];
                    return this.layoutModel.getConcArgs();

                } catch (e) {
                    console.error(e);
                    throw e;
                }
            }
        );
        return prom;
    }

    private createAudioLink(textChunk:TextChunk):string {
        let tmp = textChunk.openLink || textChunk.closeLink;
        if (tmp) {
            return this.layoutModel.createActionUrl(
                'audio',
                [['corpname', this.baseCorpname], ['chunk', tmp.speechPath]]
            );

        } else {
            return null;
        }
    }

    private changeMainCorpus(corpusId:string) {
        let args:MultiDict = this.layoutModel.getConcArgs();
        let link;

        if (this.hasKwic(corpusId)) {
            args.set('maincorp', corpusId);
            args.set('viewmode', 'align');
            args.add('q', 'x-' + corpusId);
            link = this.layoutModel.createActionUrl('view') + '?' + this.layoutModel.encodeURLParameters(args);

        } else {
            args.set('maincorp', corpusId);
            args.set('within', 1);
            link = this.layoutModel.createActionUrl('filter_form') + '?' + this.layoutModel.encodeURLParameters(args);
        }
        window.location.href = link; // TODO (should go through a router of some kind)
    }

    private playAudio(lineIdx:number, chunks:Array<TextChunk>) {
        if (this.playerAttachedChunk) {
            this.audioPlayer.stop();
            this.playerAttachedChunk.showAudioPlayer = false;
        }
        let availChunks = this.lines.get(lineIdx).languages.get(0).getAllChunks();
        let triggerIdx = availChunks.indexOf(chunks[chunks.length - 1]);
        let line = this.lines.get(lineIdx);
        availChunks.get(triggerIdx).showAudioPlayer = true;
        this.playerAttachedChunk = availChunks.get(triggerIdx);
        this.audioPlayer.start(chunks.map(item => this.createAudioLink(item)).filter(item => !!item));
    }

    private setStopStatus():void {
        if (this.playerAttachedChunk) {
            this.playerAttachedChunk.showAudioPlayer = false;
            this.playerAttachedChunk = null;
            this.notifyChangeListeners();
        }
    }

    private handlePlayerControls(action) {
        switch (action) {
            case 'play':
                this.audioPlayer.play();
            break;
            case 'pause':
                this.audioPlayer.pause();
            break;
            case 'stop':
                this.audioPlayer.stop();
                this.setStopStatus();
            break;
        }
    }

    private calculateAdHocIpm():RSVP.Promise<number> {
        return this.layoutModel.ajax<AjaxResponse.WithinMaxHits>(
            'GET',
            this.layoutModel.createActionUrl('ajax_get_within_max_hits'),
            this.layoutModel.getConcArgs(),
            {contentType : 'application/x-www-form-urlencoded'}

        ).then(
            (data) => {
                this.adHocIpm = this.concSummary.fullSize / data.total * 1e6;
                return this.adHocIpm;
            }
        )
    }

    hasKwic(corpusId:string):boolean {
        return this.kwicCorps.indexOf(corpusId) > -1;
    }

    getLines():Immutable.List<Line> {
        return this.lines;
    }

    getPagination():ServerPagination {
        return this.pagination;
    }

    getCurrentPage():number {
        return this.currentPage;
    }

    bindExternalRefsDetailFn(fn:(corpusId:string, tokenNum:number, lineIdx:number)=>void):void {
        this.externalRefsDetailFn = fn;
    }

    bindExternalKwicDetailFn(fn:(corpusId:string, tokenNum:number, lineIdx:number)=>void):void {
        this.externalKwicDetailFn = fn;
    }

    setLineFocus(lineIdx:number, focus:boolean) {
        this.lines.forEach(item => {
            item.hasFocus = false;
        });
        this.lines.get(lineIdx).hasFocus = focus; // TODO mutability issues
    }

    isUnfinishedCalculation():boolean {
        return this.unfinishedCalculation;
    }

    getConcSummary():ConcSummary {
        return this.concSummary;
    }

    providesAdHocIpm():boolean {
        return this.containsWithin;
    }

    getAdHocIpm():number {
        return this.adHocIpm;
    }

    getSubCorpName():string {
        return this.subCorpName;
    }

    audioPlayerIsVisible():boolean {
        return !!this.playerAttachedChunk;
    }

    getAudioPlayerStatus():string {
        return ['stop', 'pause', 'play'][this.audioPlayer.getStatus()];
    }

}

