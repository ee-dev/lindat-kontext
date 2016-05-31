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

/// <reference path="../../../ts/declarations/common.d.ts" />
/// <reference path="../../../ts/declarations/flux.d.ts" />
/// <reference path="../../../ts/declarations/rsvp.d.ts" />
/// <reference path="../../../ts/declarations/immutable.d.ts" />

import util = require('../../util');
import tplDocument = require('../../tpl/document');
import RSVP = require('vendor/rsvp');
import textTypesStore = require('../../stores/textTypes');
import Immutable = require('vendor/immutable');


interface ServerBibData {
    bib_data:Array<Array<string>>;
}


export interface SelectionStep {
    num:number;
    attributes:Immutable.List<string>;
    numPosInfo:string;
}

export interface TTSelectionStep extends SelectionStep {
    values:Immutable.Map<string, Array<string>>;
}

export interface AlignedLangSelectionStep extends SelectionStep {
    languages:Array<string>;
}


interface FilterResponseValue {
    v:string;
    lock:boolean;
    ident?:string;
    availItems?:string;
}

export interface AlignedLanguageItem {
    value:string;
    label:string;
    selected:boolean;
    locked:boolean;
}

function isArr(v) {
    return Object.prototype.toString.call(v) === '[object Array]';
}

/**
 * Note: the update procedure expects values within attribute blocks
 * to keep the order (including initial data):
 *
 * attr1: v1#1, v1#2, v1#3
 * attr2: v2#1, v2#2, v2#3
 * attr3: v3#1, v3#2, v3#3
 *
 * --- filter response from server -->
 *
 * attr1: v1#1, v1#3 [OK]
 * attr2: v2#3 [OK]
 * attr3: v3#1 v3#2 [WRONG]
 */
export class LiveAttrsStore extends util.SimplePageStore {

    private pluginApi:Kontext.PluginApi;

    private userData:Kontext.UserCredentials;

    private textTypesStore:TextTypes.ITextTypesStore;

    private selectionSteps:Immutable.List<SelectionStep>;

    private alignedCorpora:Immutable.List<AlignedLanguageItem>;

    private initialAlignedCorpora:Immutable.List<AlignedLanguageItem>;

    private bibliographyAttribute:string;

    private bibliographyIds:Immutable.List<string>;

    constructor(pluginApi:Kontext.PluginApi, dispatcher:Dispatcher.Dispatcher<any>,
            textTypesStore:TextTypes.ITextTypesStore, bibAttr:string) {
        super(dispatcher);
        let self = this;
        this.pluginApi = pluginApi;
        this.userData = null;
        this.bibliographyAttribute = bibAttr;
        this.textTypesStore = textTypesStore;
        this.selectionSteps = Immutable.List<SelectionStep>([]);
        this.alignedCorpora = Immutable.List(this.pluginApi.getConf<Array<any>>('availableAlignedCorpora')
                        .map((item) => {
                            return {
                                value: item.n,
                                label: item.label,
                                selected: false,
                                locked: false
                            };
                        }));
        this.bibliographyIds = Immutable.List([]);
        this.initialAlignedCorpora = this.alignedCorpora;
        this.dispatcher.register(function (payload:Kontext.DispatcherPayload) {
            switch (payload.actionType) {
                case 'LIVE_ATTRIBUTES_REFINE_CLICKED':
                    self.processRefine().then(
                        (v) => {
                            self.textTypesStore.notifyChangeListeners('$TT_VALUES_FILTERED'); // TODO is this correct in terms of design?
                            self.notifyChangeListeners('$LIVE_ATTRIBUTES_REFINE_DONE');
                        },
                        (err) => {
                            self.pluginApi.showMessage('error', err);
                        }
                    );
                break;
                case 'LIVE_ATTRIBUTES_ALIGNED_CORP_CHANGED':
                    let item = self.alignedCorpora.get(payload.props['idx']);
                    if (item) {
                        let idx = self.alignedCorpora.indexOf(item);
                        let newItem:AlignedLanguageItem = {
                            value: item.value,
                            label: item.label,
                            locked: item.locked,
                            selected: !item.selected
                        };
                        self.alignedCorpora = self.alignedCorpora.set(idx, newItem);
                    }
                    self.notifyChangeListeners('$LIVE_ATTRIBUTES_VALUE_CHECKBOX_CLICKED');
                break;
                case 'LIVE_ATTRIBUTES_RESET_CLICKED':
                    self.textTypesStore.reset();
                    self.reset();
                    self.textTypesStore.notifyChangeListeners('VALUES_RESET');
                    self.notifyChangeListeners('$LIVE_ATTRIBUTES_VALUES_RESET');
                break;
            }
        });
    }

    private processRefine():RSVP.Promise<any> {
        this.textTypesStore.getAttributesWithSelectedItems(false).forEach((attrName:string) => {
            this.textTypesStore.updateItems(attrName, (item:TextTypes.AttributeValue) => {
                return {
                    value: item.value,
                    selected: item.selected,
                    locked: true
                }
            });
        });
        let prom = this.loadFilteredData(this.textTypesStore.exportSelections());
        return prom.then(
            (data) => {
                let filterData = this.importFilter(data);
                let k;
                for (k in filterData) {
                    this.textTypesStore.filterItems(k, filterData[k].map((v) =>v.v));
                    this.textTypesStore.updateItems(k, (v, i) => {
                        return {
                            value: v.value,
                            selected: v.selected,
                            locked: v.locked,
                            availItems: filterData[k][i].availItems,
                            extendedInfo: v.extendedInfo
                        };
                    });
                }
                this.alignedCorpora = this.alignedCorpora.map((value) => {
                    let newVal:AlignedLanguageItem = {
                        label: value.label,
                        value: value.value,
                        locked: value.selected ? true : false,
                        selected: value.selected
                    }
                    return newVal;
                }).filter(item=>item.locked).toList();
                this.updateSelectionSteps(data);
                if (isArr(filterData[this.bibliographyAttribute])) {
                    this.bibliographyIds = Immutable.List<string>(
                                filterData[this.bibliographyAttribute].map(v => v.ident));
                    this.textTypesStore.setExtendedInfoSupport(
                        this.bibliographyAttribute,
                        (idx:number) => {
                            return this.loadBibInfo(this.bibliographyIds.get(idx)).then(
                                (serverData:ServerBibData) => {
                                    let bibData:Immutable.Map<string, any> = Immutable.Map<string, any>(serverData.bib_data);
                                    this.textTypesStore.setExtendedInfo(this.bibliographyAttribute,
                                        idx, bibData);
                                },
                                (err:any) => {
                                    this.pluginApi.showMessage('error', err);
                                }
                            );
                        }
                    );
                }
            },
            (err) => {
                this.pluginApi.showMessage('error', err);
            }
        );
    }

    private reset():void {
        this.selectionSteps = this.selectionSteps.clear();
        this.alignedCorpora = this.initialAlignedCorpora;
        this.bibliographyIds = this.bibliographyIds.clear();
    }

    private updateSelectionSteps(data:any):void {
        if (this.selectionSteps.size === 0 && this.alignedCorpora.filter(item=>item.selected).size > 0) {
            let mainLang = this.pluginApi.getConf<string>('corpname');
            let newStep:AlignedLangSelectionStep = {
                num: 1,
                numPosInfo: '',
                attributes : Immutable.List([]),
                languages : this.alignedCorpora
                                    .splice(0, 0, {
                                        value: mainLang,
                                        label: mainLang,
                                        selected: true,
                                        locked: true
                                    })
                                    .filter((item)=>item.selected).map((item)=>item.value).toArray()
            }
            this.selectionSteps = this.selectionSteps.push(newStep);

        } else {
            let newAttrs = this.getUnusedAttributes();
            let newStep:TTSelectionStep = {
                num: this.selectionSteps.size + 1,
                numPosInfo: data['poscount'],
                attributes: Immutable.List(newAttrs),
                values: Immutable.Map<string, Array<string>>(newAttrs.map((item) => {
                    return [item, this.textTypesStore.getAttribute(item).exportSelections()];
                }))
            };
            this.selectionSteps = this.selectionSteps.push(newStep);
        }
    }

    getAlignedCorpora():Immutable.List<AlignedLanguageItem> {
        return this.alignedCorpora;
    }

    getUnusedAttributes():Array<string> {
        let used = this.getUsedAttributes();
        return this.textTypesStore.getAttributesWithSelectedItems(true).filter((item) => {
            return used.indexOf(item) === -1;
        });
    }

    getUsedAttributes():Array<string> {
        return this.selectionSteps.reduce((red:Immutable.List<any>, val:SelectionStep) => {
            return red.concat(val.attributes);
        }, Immutable.List([])).toArray();
    }

    getSelectionSteps():Array<SelectionStep> {
        return this.selectionSteps.toArray();
    }

    hasSelectedAlignedLanguages():boolean {
        return this.alignedCorpora.find((item)=>item.selected) !== undefined;
    }

    private importFilter(data:any):{[k:string]:Array<FilterResponseValue>} {
        let ans:any = {};
        for (let k in data) {
            if (k.indexOf('.') > 0) {
                if (isArr(data[k])) {
                    ans[k] = data[k].map((v) => {
                        if (isArr(v)) {
                            return {
                                v: v[0],
                                ident: v[1],
                                lock: false,
                                availItems: v[3]
                            };

                        } else {
                            return {
                                v: v,
                                ident: null,
                                lock: true,
                                availItems: null
                            };
                        }
                    });
                    this.textTypesStore.setAttrSummary(k, null);

                } else if (typeof data[k] === 'object' && 'length' in data[k]) {
                    this.textTypesStore.setAttrSummary(k, {
                        text: this.pluginApi.translate('query__tt_{num}_items',
                                {num: data[k]['length']}),
                        help: this.pluginApi.translate('ucnkLA__bib_list_warning')
                    });
                }
            }
        }
        return ans;
    }

    private loadBibInfo(bibId:string):RSVP.Promise<any> {
        return this.pluginApi.ajax(
            'GET',
            this.pluginApi.createActionUrl('corpora/bibliography'),
            {
                corpname: this.pluginApi.getConf<string>('corpname'),
                id: bibId
            },
            {contentType : 'application/x-www-form-urlencoded'}
        );
    }

    private loadFilteredData(selections:any):RSVP.Promise<any> {
        let aligned = this.alignedCorpora.filter((item)=>item.selected).map((item)=>item.value).toArray();
        return this.pluginApi.ajax(
            'GET',
            this.pluginApi.createActionUrl('filter_attributes'),
            {
                corpname: this.pluginApi.getConf<string>('corpname'),
                attrs: JSON.stringify(selections),
                aligned: JSON.stringify(aligned)
            },
            {contentType : 'application/x-www-form-urlencoded'}
        );
    }
}