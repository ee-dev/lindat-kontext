/*
 * Copyright (c) 2018 Charles University in Prague, Faculty of Arts,
 *                    Institute of the Czech National Corpus
 * Copyright (c) 2018 Tomas Machalek <tomas.machalek@gmail.com>
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

import {Kontext} from '../../../types/common';
import * as Immutable from 'immutable';
import {StatelessModel} from '../../../models/base';
import {GeneralQueryModel} from '../main';
import {PageModel} from '../../../app/main';
import {AttrHelper} from './attrs';
import {highlightSyntax} from './main';
import {QueryInputSetQueryProps} from '../../../models/query/main';
import {ActionDispatcher, ActionPayload, typedProps, SEDispatcher} from '../../../app/dispatcher';

/**
 *
 */
export interface CQLEditorModelState {

    rawCode:Immutable.Map<string, string>;

    richCode:Immutable.Map<string, string>;

    message:Immutable.Map<string, string>;

    rawAnchorIdx:number;

    rawFocusIdx:number;

    isEnabled:boolean;

}

interface CQLEditorSetRawQueryProps {
    sourceId:string;
    query:string;
    range?:[number, number];
    rawFocusIdx:number;
    rawAnchorIdx:number;
}


export interface CQLEditorModelInitArgs {
    dispatcher:ActionDispatcher;
    pageModel:PageModel;
    attrList:Array<Kontext.AttrItem>;
    structAttrList:Array<Kontext.AttrItem>;
    tagAttr:string;
    actionPrefix:string;
    isEnabled:boolean;
}


/**
 *
 */
export class CQLEditorModel extends StatelessModel<CQLEditorModelState> {

    private pageModel:PageModel;

    private attrHelper:AttrHelper;

    private attrList:Immutable.List<Kontext.AttrItem>;

    private structAttrList:Immutable.List<Kontext.AttrItem>;

    private actionPrefix:string;

    private hintListener:(state:CQLEditorModelState, sourceId:string, msg:string)=>void;


    constructor({dispatcher, pageModel, attrList, structAttrList, tagAttr,
                    actionPrefix, isEnabled}:CQLEditorModelInitArgs) {
        super(
            dispatcher,
            {
                rawCode: Immutable.Map<string, string>(),
                richCode: Immutable.Map<string, string>(),
                message: Immutable.Map<string, string>(),
                rawAnchorIdx: 0,
                rawFocusIdx: 0,
                isEnabled: isEnabled
            }
        );
        this.attrHelper = new AttrHelper(attrList, structAttrList, tagAttr);
        this.pageModel = pageModel;
        this.actionPrefix = actionPrefix;
        this.hintListener = (state, sourceId, msg) => {
            state.message = state.message.set(sourceId, msg);
        }
    }

    reduce(state:CQLEditorModelState, action:ActionPayload):CQLEditorModelState {
        let newState:CQLEditorModelState;
        switch (action.actionType) {
            case 'CQL_EDITOR_ENABLE':
                newState = this.copyState(state);
                newState.isEnabled = true;
                newState.rawCode.forEach((query, sourceId) => {
                    newState.richCode = newState.richCode.set(
                        sourceId,
                        highlightSyntax(
                            state.rawCode.get(sourceId),
                            'cql',
                            this.pageModel.getComponentHelpers(),
                            this.attrHelper,
                            (msg) => this.hintListener(state, sourceId, msg)
                        )
                    );
                });
            break;
            case 'CQL_EDITOR_DISABLE':
                newState = this.copyState(state);
                newState.isEnabled = false;
            break;
            case 'CQL_EDITOR_SET_RAW_QUERY': {
                newState = this.copyState(state);
                const args = typedProps<CQLEditorSetRawQueryProps>(action.props);
                if (args.rawAnchorIdx !== undefined && args.rawFocusIdx !== undefined) {
                    newState.rawAnchorIdx = args.rawAnchorIdx;
                    newState.rawFocusIdx = args.rawFocusIdx;
                }
                this.setRawQuery(
                    newState,
                    args.sourceId,
                    args.query,
                    args.range
                );
                if (args.range) {
                    this.moveCursorToPos(
                        newState, args.sourceId, args.range[0] + args.query.length - 1);
                }
            }
            break;
            case 'QUERY_INPUT_SET_QUERY':
                newState = this.copyState(state);
                this.setRawQuery(
                    newState,
                    <string>action.props['sourceId'],
                    <string>action.props['query'],
                    null
                );
            break;
            case 'QUERY_INPUT_APPEND_QUERY':
                newState = this.copyState(state);
                this.setRawQuery(
                    newState,
                    <string>action.props['sourceId'],
                    <string>action.props['query'],
                    [
                        this.getQueryLength(newState, action.props['sourceId']),
                        this.getQueryLength(newState, action.props['sourceId'])
                    ]
                );
                this.moveCursorToEnd(newState, action.props['sourceId']);
            break;
            case 'QUERY_INPUT_REMOVE_LAST_CHAR': {
                newState = this.copyState(state);
                const queryLength = newState.rawCode.get(action.props['sourceId']).length;
                this.setRawQuery(
                    newState,
                    <string>action.props['sourceId'],
                    '',
                    [queryLength - 1, queryLength]
                );
                this.moveCursorToEnd(newState, action.props['sourceId']);
            }
            break;
            case '@EDIT_QUERY_OPERATION':
                newState = this.copyState(state);
                if (action.props['queryType'] === 'cql') {
                    this.setRawQuery(
                        newState,
                        action.props['sourceId'],
                        action.props['query'],
                        null
                    );
                }
            break;
            default:
                newState = state;
        }
        return newState;
    }

    sideEffects(state:CQLEditorModelState, action:ActionPayload, dispatch:SEDispatcher) {
        switch (action.actionType) {
            case 'CQL_EDITOR_SET_RAW_QUERY': {
                const args = typedProps<QueryInputSetQueryProps>(action.props);
                dispatch({
                    actionType: `@${this.actionPrefix}QUERY_INPUT_SET_QUERY`,
                    props: {
                        sourceId: args.sourceId,
                        query: args.query
                    }
                });
            }
            break;
        }
    }

    private getQueryLength(state:CQLEditorModelState, sourceId:string):number {
        return state.rawCode.has(sourceId) ? state.rawCode.get(sourceId).length : 0;
    }

    private moveCursorToPos(state:CQLEditorModelState, sourceId:string, posIdx:number):void {
        state.rawAnchorIdx = posIdx;
        state.rawFocusIdx = posIdx;
    }

    private moveCursorToEnd(state:CQLEditorModelState, sourceId:string):void {
        this.moveCursorToPos(state, sourceId, state.rawCode.get(sourceId).length);
    }

    /**
     * @param range in case we want to insert a CQL snipped into an existing code;
     *              if undefined then whole query is replaced
     */
    private setRawQuery(state:CQLEditorModelState, sourceId:string, query:string, range:[number, number]):void {
        let newQuery:string;

        if (!state.rawCode.has(sourceId)) {
            state.rawCode = state.rawCode.set(sourceId, '');
        }
        if (Array.isArray(range)) {
            newQuery = state.rawCode.get(sourceId).substring(0, range[0]) + query +
                state.rawCode.get(sourceId).substr(range[1]);

        } else {
            newQuery = query;
        }

        state.rawCode = state.rawCode.set(
            sourceId,
            newQuery
        );

        if (state.isEnabled) {
            state.richCode = state.richCode.set(
                sourceId,
                highlightSyntax(
                    state.rawCode.get(sourceId),
                    'cql',
                    this.pageModel.getComponentHelpers(),
                    this.attrHelper,
                    (msg) => this.hintListener(state, sourceId, msg)
                )
            );

        } else {
            state.richCode = state.richCode.set(sourceId, '');
        }
    }

}