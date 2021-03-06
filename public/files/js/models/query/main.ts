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

/// <reference path="../../vendor.d.ts/cqlParser.d.ts" />

import {Kontext, ViewOptions} from '../../types/common';
import {AjaxResponse} from '../../types/ajaxResponses';
import * as Immutable from 'immutable';
import RSVP from 'rsvp';
import * as Rx from '@reactivex/rxjs';
import {SynchronizedModel, StatefulModel} from '../base';
import {PageModel} from '../../app/main';
import {ActionDispatcher, ActionPayload} from '../../app/dispatcher';
import {MultiDict} from '../../util';
import {parse as parseQuery, ITracer} from 'cqlParser/parser';
import {TextTypesModel} from '../textTypes/attrValues';
import {QueryContextModel} from './context';
import {PluginInterfaces} from '../../types/plugins';


export interface GeneralQueryFormProperties {
    forcedAttr:string;
    attrList:Array<Kontext.AttrItem>;
    structAttrList:Array<Kontext.AttrItem>;
    lemmaWindowSizes:Array<number>;
    posWindowSizes:Array<number>;
    wPoSList:Array<{v:string; n:string}>;
    useCQLEditor:boolean;
    tagAttr:string;
}


export interface QueryFormUserEntries {
    currQueryTypes:{[corpname:string]:string};
    currQueries:{[corpname:string]:string};  // current queries values (e.g. when restoring a form state)
    currPcqPosNegValues:{[corpname:string]:string};
    currDefaultAttrValues:{[corpname:string]:string};
    currLposValues:{[corpname:string]:string};
    currQmcaseValues:{[corpname:string]:boolean};
}


export interface QueryFormProperties extends GeneralQueryFormProperties, QueryFormUserEntries {
    corpora:Array<string>;
    availableAlignedCorpora:Array<Kontext.AttrItem>;
    textTypesNotes:string;
    subcorpList:Array<Kontext.SubcorpListItem>;
    currentSubcorp:string;
    origSubcorpName:string;
    tagBuilderSupport:{[corpname:string]:boolean};
    shuffleConcByDefault:boolean;
    inputLanguages:{[corpname:string]:string};
    selectedTextTypes:{[structattr:string]:Array<string>};
    hasLemma:{[corpname:string]:boolean};
    tagsetDocs:{[corpname:string]:boolean};
}

export type WidgetsMap = Immutable.Map<string, Immutable.List<string>>;


export function appendQuery(origQuery:string, query:string, prependSpace:boolean):string {
    return origQuery + (origQuery && prependSpace ? ' ' : '') + query;
}

export interface QueryInputSetQueryProps {
    sourceId:string;
    query:string;
}

/**
 *
 * @param data
 */
export const fetchQueryFormArgs = (data:{[ident:string]:AjaxResponse.ConcFormArgs}):AjaxResponse.QueryFormArgsResponse => {
    const k = (() => {
        for (let p in data) {
            if (data.hasOwnProperty(p) && data[p].form_type === 'query') {
                return p;
            }
        }
        return null;
    })();

    if (k !== null) {
        return <AjaxResponse.QueryFormArgsResponse>data[k];

    } else {
        return {
            messages: [],
            form_type: 'query',
            op_key: '__new__',
            curr_query_types: {},
            curr_queries: {},
            curr_pcq_pos_neg_values: {},
            curr_lpos_values: {},
            curr_qmcase_values: {},
            curr_default_attr_values: {},
            tag_builder_support: {},
            selected_text_types: {},
            bib_mapping: {},
            has_lemma: {},
            tagset_docs:{}
        };
    }
};



/**
 *
 */
export abstract class GeneralQueryModel extends SynchronizedModel {

    protected pageModel:PageModel;

    protected forcedAttr:string;

    protected attrList:Immutable.List<Kontext.AttrItem>;

    protected structAttrList:Immutable.List<Kontext.AttrItem>;

    protected lemmaWindowSizes:Immutable.List<number>;

    protected posWindowSizes:Immutable.List<number>;

    protected wPoSList:Immutable.List<{v:string; n:string}>;

    protected currentAction:string;

    // ----- other models

    protected textTypesModel:TextTypesModel;

    protected queryContextModel:QueryContextModel;

    protected queryTracer:ITracer;

    // ----

    protected useCQLEditor:boolean;

    private tagAttr:string;

    private widgetArgs:Kontext.GeneralProps;

    // -------


    constructor(
            dispatcher:ActionDispatcher,
            pageModel:PageModel,
            textTypesModel:TextTypesModel,
            queryContextModel:QueryContextModel,
            props:GeneralQueryFormProperties) {
        super(dispatcher);
        this.pageModel = pageModel;
        this.textTypesModel = textTypesModel;
        this.queryContextModel = queryContextModel;
        this.forcedAttr = props.forcedAttr;
        this.attrList = Immutable.List<Kontext.AttrItem>(props.attrList);
        this.structAttrList = Immutable.List<Kontext.AttrItem>(props.structAttrList);
        this.lemmaWindowSizes = Immutable.List<number>(props.lemmaWindowSizes);
        this.posWindowSizes = Immutable.List<number>(props.posWindowSizes);
        this.wPoSList = Immutable.List<{v:string; n:string}>(props.wPoSList);
        this.tagAttr = props.tagAttr;
        this.queryTracer = {trace:(_)=>undefined};
        this.useCQLEditor = props.useCQLEditor;

        this.dispatcher.register(payload => {
            switch (payload.actionType) {
                case 'QUERY_INPUT_SET_ACTIVE_WIDGET':
                    this.setActiveWidget(payload.props['sourceId'], payload.props['value']);
                    this.widgetArgs = payload.props['widgetArgs'] || {};
                    this.notifyChangeListeners();
                break;
            }
        });
    }

    /**
     * Returns a currently active widget identifier
     * (one of 'tag', 'keyboard', 'within', 'history')
     */
    abstract getActiveWidget(sourceId:string):string;

    /**
     * Sets a currently active widget.
     */
    abstract setActiveWidget(sourceId:string, ident:string):void;


    abstract getQueries():Immutable.Map<string, string>;

    abstract getQuery(sourceId:string):string;

    abstract getQueryTypes():Immutable.Map<string, string>;

    /// ---------

    getWidgetArgs():Kontext.GeneralProps {
        return this.widgetArgs;
    }

    getForcedAttr():string {
        return this.forcedAttr;
    }

    getAttrList():Immutable.List<Kontext.AttrItem> {
        return this.attrList;
    }

    getStructAttrList():Immutable.List<Kontext.AttrItem> {
        return this.structAttrList;
    }

    getLemmaWindowSizes():Immutable.List<number> {
        return this.lemmaWindowSizes;
    }

    getPosWindowSizes():Immutable.List<number> {
        return this.posWindowSizes;
    }

    getwPoSList():Immutable.List<{v:string; n:string}> {
        return this.wPoSList;
    }

    protected validateQuery(query:string, queryType:string):boolean {
        const parseFn = ((query:string) => {
            switch (queryType) {
                case 'iquery':
                    return () => {
                        if (!!(/^"[^\"]+"$/.exec(query) || /^(\[(\s*\w+\s*!?=\s*"[^"]*"(\s*[&\|])?)+\]\s*)+$/.exec(query))) {
                            throw new Error();
                        }
                    }
                case 'phrase':
                    return parseQuery.bind(null, query, {startRule: 'PhraseQuery', tracer: this.queryTracer});
                case 'lemma':
                case 'word':
                    return parseQuery.bind(null, query, {startRule: 'RegExpRaw', tracer: this.queryTracer});
                case 'cql':
                    return parseQuery.bind(null, query + ';', {tracer: this.queryTracer});
                default:
                    return () => {};
            }
        })(query.trim());

        let mismatch;
        try {
            parseFn();
            mismatch = false;

        } catch (e) {
            mismatch = true;
            console.error(e);
        }
        return mismatch;
    }


    onSettingsChange(optsModel:ViewOptions.IGeneralViewOptionsModel):void {
        this.useCQLEditor = optsModel.getUseCQLEditor();
        this.notifyChangeListeners();
    }

    getTagAttr():string {
        return this.tagAttr;
    }

    getUseCQLEditor():boolean {
        return this.useCQLEditor;
    }
}

/**
 *
 */
export interface CorpusSwitchPreserved {
    query:string;
    queryType:string;
    matchCase:boolean;
}


/**
 *
 */
export class QueryModel extends GeneralQueryModel implements PluginInterfaces.Corparch.ICorpSelection, Kontext.ICorpusSwitchAware<CorpusSwitchPreserved> {

    private corpora:Immutable.List<string>;

    private availableAlignedCorpora:Immutable.List<Kontext.AttrItem>;

    private subcorpList:Immutable.List<Kontext.SubcorpListItem>;

    private currentSubcorp:string;

    private origSubcorpName:string;

    private shuffleConcByDefault:boolean;

    private queries:Immutable.Map<string, string>; // corpname -> query

    private lposValues:Immutable.Map<string, string>; // corpname -> lpos

    private matchCaseValues:Immutable.Map<string, boolean>; // corpname -> qmcase

    private defaultAttrValues:Immutable.Map<string, string>;

    private pcqPosNegValues:Immutable.Map<string, string>;

    private queryTypes:Immutable.Map<string, string>;

    private tagBuilderSupport:Immutable.Map<string, boolean>;

    private inputLanguages:Immutable.Map<string, string>;

    private activeWidgets:Immutable.Map<string, string>;

    private hasLemma:Immutable.Map<string, boolean>;

    private tagsetDocs:Immutable.Map<string, string>;

    /**
     * Text descriptions of text type structure for end user.
     * (applies for the main corpus)
     */
    private textTypesNotes:string;

    /**
     * This does not equal to URL param shuffle=0/1.
     * If false then the decision is up to server
     * (= user settings). If true then shuffle is
     * set to '0' no matter what value is in user's
     * settings. By default this is set to false.
     *
     * We need this when replaying query chain
     * - otherwise the server would append another
     * shuffle to the initial query operation
     * (if applicable).
     */
    private shuffleForbidden:boolean = false;


    // ----------------------

    constructor(
            dispatcher:ActionDispatcher,
            pageModel:PageModel,
            textTypesModel:TextTypesModel,
            queryContextModel:QueryContextModel,
            props:QueryFormProperties) {
        super(dispatcher, pageModel, textTypesModel, queryContextModel, props);
        this.corpora = Immutable.List<string>(props.corpora);
        this.availableAlignedCorpora = Immutable.List<Kontext.AttrItem>(props.availableAlignedCorpora);
        this.subcorpList = Immutable.List<Kontext.SubcorpListItem>(props.subcorpList);
        this.currentSubcorp = props.currentSubcorp || '';
        this.origSubcorpName = props.origSubcorpName || '';
        this.shuffleConcByDefault = props.shuffleConcByDefault;
        this.queries = Immutable.Map<string, string>(props.corpora.map(item => [item, props.currQueries[item] || '']));
        this.lposValues = Immutable.Map<string, string>(props.corpora.map(item => [item, props.currLposValues[item] || '']));
        this.matchCaseValues = Immutable.Map<string, boolean>(props.corpora.map(item => [item, props.currQmcaseValues[item] || false]));
        this.defaultAttrValues = Immutable.Map<string, string>(props.corpora.map(item => [item, props.currDefaultAttrValues[item] || 'word']));
        this.queryTypes = Immutable.Map<string, string>(props.corpora.map(item => [item, props.currQueryTypes[item] || 'iquery'])).toMap();
        this.pcqPosNegValues = Immutable.Map<string, string>(props.corpora.map(item => [item, props.currPcqPosNegValues[item] || 'pos']));
        this.tagBuilderSupport = Immutable.Map<string, boolean>(props.tagBuilderSupport);
        this.inputLanguages = Immutable.Map<string, string>(props.inputLanguages);
        this.hasLemma = Immutable.Map<string, boolean>(props.hasLemma);
        this.tagsetDocs = Immutable.Map<string, string>(props.tagsetDocs);
        this.textTypesNotes = props.textTypesNotes;
        this.activeWidgets = Immutable.Map<string, string>(props.corpora.map(item => null));
        this.setUserValues(props);
        this.currentAction = 'first_form';

        this.dispatcher.register(payload => {
            switch (payload.actionType) {
                case 'CQL_EDITOR_DISABLE':
                    this.notifyChangeListeners();
                break;
                case 'QUERY_INPUT_SELECT_TYPE':
                    let qType = payload.props['queryType'];
                    if (!this.hasLemma.get(payload.props['sourceId']) &&  qType === 'lemma') {
                        qType = 'phrase';
                        this.pageModel.showMessage('warning', 'Lemma attribute not available, using "phrase"');
                    }
                    this.queryTypes = this.queryTypes.set(payload.props['sourceId'], qType);
                    this.notifyChangeListeners();
                break;
                case 'CORPARCH_FAV_ITEM_CLICK':

                break;
                case 'QUERY_INPUT_SELECT_SUBCORP':
                    if (payload.props['pubName']) {
                        this.currentSubcorp = payload.props['pubName'];
                        this.origSubcorpName = payload.props['subcorp'];

                    } else {
                        this.currentSubcorp = payload.props['subcorp'];
                        this.origSubcorpName = payload.props['subcorp'];
                    }
                    this.notifyChangeListeners();
                break;
                case 'QUERY_INPUT_SET_QUERY':
                case '@QUERY_INPUT_SET_QUERY':
                    this.queries = this.queries.set(payload.props['sourceId'], payload.props['query']);
                    this.notifyChangeListeners();
                break;
                case 'QUERY_INPUT_APPEND_QUERY':
                    this.queries = this.queries.set(
                        payload.props['sourceId'],
                        appendQuery(
                            this.queries.get(payload.props['sourceId']),
                            payload.props['query'],
                            !!payload.props['prependSpace']
                        )
                    );
                    if (payload.props['closeWhenDone']) {
                        this.activeWidgets = this.activeWidgets.set(payload.props['sourceId'], null);
                    }
                    this.notifyChangeListeners();
                break;
                case 'QUERY_INPUT_REMOVE_LAST_CHAR':
                    const currQuery2 = this.queries.get(payload.props['sourceId']);
                    if (currQuery2.length > 0) {
                        this.queries = this.queries.set(payload.props['sourceId'], currQuery2.substr(0, currQuery2.length - 1));
                    }
                    this.notifyChangeListeners();
                break;
                case 'QUERY_INPUT_SET_LPOS':
                    this.lposValues = this.lposValues.set(payload.props['sourceId'], payload.props['lpos']);
                    this.notifyChangeListeners();
                break;
                case 'QUERY_INPUT_SET_MATCH_CASE':
                    this.matchCaseValues = this.matchCaseValues.set(payload.props['sourceId'], payload.props['value']);
                    this.notifyChangeListeners();
                break;
                case 'QUERY_INPUT_SET_DEFAULT_ATTR':
                    this.defaultAttrValues = this.defaultAttrValues.set(payload.props['sourceId'], payload.props['value']);
                    this.notifyChangeListeners();
                break;
                case 'QUERY_INPUT_ADD_ALIGNED_CORPUS':
                    this.addAlignedCorpus(payload.props['corpname']);
                    this.notifyChangeListeners();
                    this.synchronize(
                        'QUERY_INPUT_ADD_ALIGNED_CORPUS',
                        payload.props
                    );
                break;
                case 'QUERY_INPUT_REMOVE_ALIGNED_CORPUS':
                    this.removeAlignedCorpus(payload.props['corpname']);
                    this.notifyChangeListeners();
                    this.synchronize(
                        'QUERY_INPUT_REMOVE_ALIGNED_CORPUS',
                        payload.props
                    );
                break;
                case 'QUERY_INPUT_SET_PCQ_POS_NEG':
                    this.pcqPosNegValues = this.pcqPosNegValues.set(payload.props['corpname'], payload.props['value']);
                    this.notifyChangeListeners();
                    break;
                case 'QUERY_MAKE_CORPUS_PRIMARY':
                    this.makeCorpusPrimary(payload.props['corpname']);
                    break;
                case 'QUERY_INPUT_SUBMIT':
                    if (this.testPrimaryQueryNonEmpty() && this.testQueryTypeMismatch()) {
                        this.submitQuery();
                    }
                break;
                case 'CORPUS_SWITCH_MODEL_RESTORE':
                    if (payload.props['key'] === this.csGetStateKey()) {
                        this.csSetState(payload.props['data']);
                    }
                break;
            }
        });
    }

    private testPrimaryQueryNonEmpty():boolean {
        if (this.queries.get(this.corpora.get(0)).length > 0) {
            return true;

        } else {
            this.pageModel.showMessage('error', this.pageModel.translate('query__query_must_be_entered'));
            return false;
        }
    }

    private testQueryTypeMismatch():boolean {
        const errors = this.corpora.map(corpname => this.isPossibleQueryTypeMismatch(corpname)).filter(err => !!err);
        return errors.size === 0 || window.confirm(this.pageModel.translate('global__query_type_mismatch'));
    }

    csExportState():CorpusSwitchPreserved {
        const corp = this.corpora.get(0);
        return {
            query: this.queries.get(corp),
            queryType: this.queryTypes.get(corp),
            matchCase: this.matchCaseValues.get(corp)
        };
    }

    csSetState(state:CorpusSwitchPreserved):void {
        const corp = this.corpora.get(0);
        this.queries = this.queries.set(corp, state.query);
        this.queryTypes = this.queryTypes.set(corp, state.queryType);
        this.matchCaseValues = this.matchCaseValues.set(corp, state.matchCase);
    }

    csGetStateKey():string {
        return 'query-storage';
    }

    getActiveWidget(sourceId:string):string {
        return this.activeWidgets.get(sourceId);
    }

    setActiveWidget(sourceId:string, ident:string):void {
        this.activeWidgets = this.activeWidgets.set(sourceId, ident);
    }

    private setUserValues(data:QueryFormUserEntries):void {
        this.queries = Immutable.Map<string, string>(this.corpora.map(item => [item, data.currQueries[item] || '']));
        this.lposValues = Immutable.Map<string, string>(this.corpora.map(item => [item, data.currLposValues[item] || '']));
        this.matchCaseValues = Immutable.Map<string, boolean>(this.corpora.map(item => [item, data.currQmcaseValues[item] || false]));
        this.defaultAttrValues = Immutable.Map<string, string>(this.corpora.map(item => [item, data.currDefaultAttrValues[item] || 'word']));
        this.queryTypes = Immutable.Map<string, string>(this.corpora.map(item => [item, data.currQueryTypes[item] || 'iquery'])).toMap();
        this.pcqPosNegValues = Immutable.Map<string, string>(this.corpora.map(item => [item, data.currPcqPosNegValues[item] || 'pos']));
    }

    syncFrom(fn:()=>RSVP.Promise<AjaxResponse.QueryFormArgs>):RSVP.Promise<AjaxResponse.QueryFormArgs> {
        return fn().then(
            (data) => {
                if (data.form_type === 'query') {
                    this.setUserValues({
                        currQueries: data.curr_queries,
                        currQueryTypes: data.curr_query_types,
                        currLposValues: data.curr_lpos_values,
                        currDefaultAttrValues: data.curr_default_attr_values,
                        currQmcaseValues: data.curr_qmcase_values,
                        currPcqPosNegValues: data.curr_pcq_pos_neg_values
                    });
                    this.tagBuilderSupport = Immutable.Map<string, boolean>(data.tag_builder_support);
                    this.hasLemma = Immutable.Map<string, boolean>(data.has_lemma);
                    this.tagsetDocs = Immutable.Map<string, string>(data.tagset_docs);
                    return data;

                } else if (data.form_type === 'locked') {
                    return null;

                } else {
                    throw new Error('Cannot sync query store - invalid form data type: ' + data.form_type);
                }
            }
        );
    }

    onSettingsChange(optsModel:ViewOptions.IGeneralViewOptionsModel):void {
        super.onSettingsChange(optsModel);
        this.shuffleConcByDefault = optsModel.getShuffle();
    }

    private makeCorpusPrimary(corpname:string):void {
        const idx = this.corpora.indexOf(corpname);
        if (idx > -1) {
            this.corpora = this.corpora.remove(idx).insert(0, corpname);
            window.location.href = this.pageModel.createActionUrl(this.currentAction, this.createSubmitArgs().items());
        }
    }

    private addAlignedCorpus(corpname:string):void {
        if (!this.corpora.contains(corpname) && this.availableAlignedCorpora.find(x => x.n === corpname)) {
            this.corpora = this.corpora.push(corpname);
            if (!this.queries.has(corpname)) {
                this.queries = this.queries.set(corpname, '');
            }
            if (!this.lposValues.has(corpname)) {
                this.lposValues = this.lposValues.set(corpname, '');
            }
            if (!this.matchCaseValues.has(corpname)) {
                this.matchCaseValues = this.matchCaseValues.set(corpname, false);
            }
            if (!this.queryTypes.has(corpname)) {
                this.queryTypes = this.queryTypes.set(corpname, 'iquery'); // TODO what about some session-stored stuff?
            }
            if (!this.pcqPosNegValues.has(corpname)) {
                this.pcqPosNegValues = this.pcqPosNegValues.set(corpname, 'pos');
            }
            if (!this.defaultAttrValues.has(corpname)) {
                this.defaultAttrValues = this.defaultAttrValues.set(corpname, 'word');
            }

        } else {
            // TODO error
        }
    }

    private removeAlignedCorpus(corpname:string):void {
        const idx = this.corpora.indexOf(corpname);
        if (idx > -1) {
            this.corpora = this.corpora.remove(idx);

        } else {
            console.error('Cannot remove corpus ', corpname);
        }
    }

    private createSubmitArgs():MultiDict {
        const primaryCorpus = this.corpora.get(0);
        const args = this.pageModel.getConcArgs();
        args.replace('corpname', [primaryCorpus]);
        if (this.currentSubcorp) {
            args.add('usesubcorp', this.currentSubcorp);
        }

        if (this.corpora.size > 1) {
            args.replace('maincorp', [primaryCorpus]);
            args.replace('align', this.corpora.rest().toArray());
            args.replace('viewmode', ['align']);

        } else {
            args.remove('maincorp');
            args.remove('align');
            args.replace('viewmode', ['kwic']);
        }
        function createArgname(name, corpname) {
            return corpname !== primaryCorpus ? name + '_' + corpname : name;
        }

        this.corpora.forEach(corpname => {
            args.add(createArgname('queryselector', corpname), `${this.queryTypes.get(corpname)}row`);
            // now we set the query; we have to remove possible new-line
            // characters as while the client's cql parser and CQL widget are ok with that
            // server is unable to parse this
            args.add(createArgname(this.queryTypes.get(corpname), corpname),
                     this.queries.get(corpname));

            if (this.lposValues.get(corpname)) {
                switch (this.queryTypes.get(corpname)) {
                    case 'lemma':
                        args.add(createArgname('lpos', corpname), this.lposValues.get(corpname));
                    break;
                    case 'word':
                        args.add(createArgname('wpos', corpname), this.lposValues.get(corpname));
                    break;
                }
            }
            if (this.matchCaseValues.get(corpname)) {
                args.add(createArgname('qmcase', corpname), this.matchCaseValues.get(corpname) ? '1' : '0');
            }
            args.replace(createArgname('pcq_pos_neg', corpname), [this.pcqPosNegValues.get(corpname)]);
            args.add(createArgname('default_attr', corpname), this.defaultAttrValues.get(corpname));
        });

        // query context
        const contextArgs = this.queryContextModel.exportForm();
        for (let k in contextArgs) {
            if (Object.prototype.toString.call(contextArgs[k]) === '[object Array]') {
                args.replace(k, contextArgs[k]);

            } else {
                args.replace(k, [contextArgs[k]]);
            }
        }

        // text types
        const ttData = this.textTypesModel.exportSelections(false);
        for (let k in ttData) {
            if (ttData.hasOwnProperty(k)) {
                args.replace('sca_' + k, ttData[k]);
            }
        }

        // default shuffle
        if (this.shuffleConcByDefault) {
            args.set('shuffle', 1);

        } else {
            args.remove('shuffle');
        }

        // default shuffling
        if (this.shuffleForbidden) {
            args.set('shuffle', 0);
        }
        return args;
    }

    submitQuery():void {
        const args = this.createSubmitArgs().items();
        const url = this.pageModel.createActionUrl('first', args);
        if (url.length < 2048) {
            window.location.href = url;

        } else {
            this.pageModel.setLocationPost(this.pageModel.createActionUrl('first'), args);
        }
    }

    getSubmitUrl():string {
        const args = this.createSubmitArgs().items();
        return this.pageModel.createActionUrl('first', args);
    }

    isPossibleQueryTypeMismatch(corpname:string):boolean {
        const query = this.queries.get(corpname);
        const queryType = this.queryTypes.get(corpname);
        return this.validateQuery(query, queryType);
    }

    getQueryTypes():Immutable.Map<string, string> {
        return this.queryTypes;
    }

    getLposValues():Immutable.Map<string, string> {
        return this.lposValues;
    }

    getMatchCaseValues():Immutable.Map<string, boolean> {
        return this.matchCaseValues;
    }

    getDefaultAttrValues():Immutable.Map<string, string> {
        return this.defaultAttrValues;
    }

    getQuery(corpname:string):string {
        return this.queries.get(corpname);
    }

    getQueries():Immutable.Map<string, string> {
        return this.queries;
    }

    supportsParallelCorpora():boolean {
        return this.corpora.size > 1 || this.availableAlignedCorpora.size > 0;
    }

    getSupportedWidgets():WidgetsMap {
        const userIsAnonymous = () => this.pageModel.getConf<boolean>('anonymousUser');
        const getCorpWidgets = (corpname:string, queryType:string):Array<string> => {
            const ans = ['keyboard'];
            if (!userIsAnonymous()) {
                ans.push('history');
            }
            if (queryType === 'cql') {
                ans.push('within');
                if (this.tagBuilderSupport.get(corpname)) {
                    ans.push('tag');
                }
            }
            return ans;
        }
        const ans = Immutable.Map<string, Immutable.List<string>>();
        return Immutable.Map<string, Immutable.List<string>>(this.corpora.map(corpname => {
            return [corpname, Immutable.List<string>(getCorpWidgets(corpname, this.queryTypes.get(corpname)))];
        }));
    }

    getPcqPosNegValues():Immutable.Map<string, string> {
        return this.pcqPosNegValues;
    }

    getCorpora():Immutable.List<string> {
        return this.corpora;
    }

    getAvailableAlignedCorpora():Immutable.List<Kontext.AttrItem> {
        return this.availableAlignedCorpora;
    }


    getAvailableSubcorpora():Immutable.List<Kontext.SubcorpListItem> {
        return this.subcorpList;
    }

    getCurrentSubcorpus():string {
        return this.currentSubcorp;
    }

    getCurrentSubcorpusOrigName():string {
        return this.origSubcorpName;
    }

    getInputLanguages():Immutable.Map<string, string> {
        return this.inputLanguages;
    }

    disableDefaultShuffling():void {
        this.shuffleForbidden = true;
    }

    getTextTypesNotes():string {
        return this.textTypesNotes;
    }

    getHasLemmaAttr():Immutable.Map<string, boolean> {
        return this.hasLemma;
    }

    getTagsetDocUrls():Immutable.Map<string, string> {
        return this.tagsetDocs;
    }
}


/**
 *
 */
export class QueryHintModel extends StatefulModel {

    private hints:Array<string>;

    private currentHint:number;

    private translatorFn:(s:string)=>string;

    constructor(dispatcher:ActionDispatcher, hints:Array<string>, translatorFn:(s:string)=>string) {
        super(dispatcher);
        const self = this;
        this.hints = hints ? hints : [];
        this.translatorFn = translatorFn;
        this.currentHint = this.randomIndex();

        this.dispatcherRegister((payload:ActionPayload) => {
            switch (payload.actionType) {
                case 'NEXT_QUERY_HINT':
                    this.setNextHint();
                    this.notifyChangeListeners();
                    break;
            }
        });
    }

    randomIndex():number {
        return Math.round((Math.random() * (this.hints.length - 1)))|0;
    }

    setNextHint():void {
        this.currentHint = (this.currentHint + 1) % this.hints.length;
    }

    getHint():string {
        return this.translatorFn(this.hints[this.currentHint]);
    }

}
