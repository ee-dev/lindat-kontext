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

/// <reference path="../../vendor.d.ts/d3.d.ts" />

import {Kontext} from '../../types/common';
import * as d3 from 'vendor/d3';


export type ReferencedValues = Array<[number,string]>;

export type DetailValue = string | ReferencedValues;


/**
 * This namespace describes a data format generated by KonText
 * in accordance with [js-treex-view](https://github.com/ufal/js-treex-view)
 * library's specification.
 */
export namespace SourceData {

    export interface Node {
        id:string;
        hint:string;
        labels:Array<string>;
        parent:string;
        firstson:string;
        rbrother:string;
        lbrother:string;
        order:number;
        depth:number;
        data:{[key:string]:DetailValue};
    }

    export interface Tree {
        layer:string;
        nodes:Array<Node>;
    }

    export interface Zone {
        trees:{[ident:string]:Tree};
        sentence:string;
    }

    export type Token = [string, string];

    export type Desc = Array<Token>;

    /**
     *
     */
    export interface Data {
        zones:{[ident:string]:Zone};
        desc:Desc;
        kwicPosition:Array<number>; // position within desc
    }
}

/**
 * Specifies a function which is joined to size
 * calculation chain in case calculated size of
 * syntax viewer frame is bigger then its maxWidth
 * or maxHeight size.
 *
 * It allows user to modify viewer's parent elements
 * to be able to handle such overflow. User may
 * or may not modify the original size passed as
 * arguments. But in any case user must return
 * valid width and height.
 */
export interface OverflowHandler {
    (width:number, height:number):[number,number];
}

/**
 * Viewer's configuration. Please note that
 * some properties are modifiable via plug-in's
 * CSS file.
 */
export interface Options {
    width?:number;
    height?:number;
    paddingTop?:number;
    paddingBottom?:number;
    paddingLeft?:number;
    paddingRight?:number;
    edgeWidth?:number;
    edgeColor?:string;
    nodeColor?:string;
    onOverflow?:OverflowHandler;
}

interface Label {
    color:string; // CSS format color
    value:string;
}

interface TreeNode {
    id:string;
    hint:string;
    labels:Array<Label>;
    parent:string;
    depth:number;
    data:{[key:string]:DetailValue},
    x:number;
    y:number;
}

type TreeNodeMap = {[ident:string]:TreeNode};

/**
 * Tree graph edge
 */
interface Edge {
    x1:number;
    y1:number;
    x2:number;
    y2:number;
}

/**
 * Linear sentence token
 */
interface Token {
    id:string;
    value:string;
    isKwic:boolean;
}


type Sentence = Array<Token>;

/**
 * Internal parameters of the drawing. Some values are
 * affected by the Options passed to the respective drawing
 * function.
 */
class DrawingParams {

    private static FALLBACK_WIDTH = 1000;

    private static FALLBACK_HEIGHT = 600;

    maxWidth:number;
    maxHeight:number;
    width:number;
    height:number;
    paddingTop:number = 20;
    paddingBottom:number = 20;
    paddingRight:number = 20;
    paddingLeft = 70;
    maxDepth:number;
    depthStep:number;
    cmlWordSteps:Array<number>; // cummulative x positions of words/nodes
    nodeStrokeColor:string = '#E2007A';
    nodeFill:string = '#E2007A';
    nodeWidth:number = 3;
    nodeHeight:number = 3;
    edgeColor:string = '#009EE0';
    edgeWidth:number = 2;

    constructor() {
        this.maxWidth = document.documentElement.clientWidth || DrawingParams.FALLBACK_WIDTH;
        this.maxHeight = document.documentElement.clientHeight || DrawingParams.FALLBACK_HEIGHT;
    }

    getAvailWidth():number {
        return this.width - this.paddingLeft - this.paddingRight;
    }
}

/**
 *
 */
class TreeGenerator {

    private params:DrawingParams;

    private detailedId:string = null;

    private componentHelpers:any;

    private sent2NodeActionMap:{[ident:string]:HTMLElement} = {};

    private node2SentActionMap:{[ident:string]:HTMLElement} = {};

    private onOverflow:OverflowHandler;

    private static HORIZONTAL_SPACING_COMPACT = 0.05;

    private static HORIZONTAL_SPACING_DEFAULT = 0.12;

    private static DYNAMIC_VERTICAL_SPACING = 40;

    private static NODE_DIV_WIDTH = 80;

    private static NODE_DIV_HEIGHT = 40;

    private static DETAIL_DIV_VERT_OFFSET = 80;

    private static DETAIL_DIV_HORIZ_OFFSET = -10;

    private static DETAIL_DIV_MIN_HEIGHT = 100;


    constructor(options:Options, componentHelpers:Kontext.ComponentHelpers) {
        this.componentHelpers = componentHelpers;
        this.params = new DrawingParams();
        this.params.width = options.width;
        this.params.height = options.height;

        if (options.paddingLeft !== undefined) {
            this.params.paddingLeft = options.paddingLeft;
        }
        if (options.paddingRight !== undefined) {
            this.params.paddingRight = options.paddingRight;
        }
        if (options.paddingTop !== undefined) {
            this.params.paddingTop = options.paddingTop;
        }
        if (options.paddingBottom !== undefined) {
            this.params.paddingBottom = options.paddingBottom;
        }
        if (options.edgeWidth !== undefined) {
            this.params.edgeWidth = options.edgeWidth;
        }
        if (options.edgeColor !== undefined) {
            this.params.edgeColor = options.edgeColor;
        }
        if (options.nodeColor !== undefined) {
            this.params.nodeFill = options.nodeColor;
            this.params.nodeStrokeColor = options.nodeColor;
        }
        if (typeof options.onOverflow === 'function') {
            this.onOverflow = options.onOverflow;
        }
    }


    generate(data:Array<SourceData.Data>, zone:string, tree:string, target:HTMLElement):void {
        const nodes = data[0].zones[zone].trees[tree].nodes;
        const tokens:Sentence = this.importSentence(data[0]);

        const nodeMap = this.generateNodeMap(nodes);
        this.calcViewSize(tokens, nodeMap);
        this.generateNodeCoords(tokens, nodeMap);
        const edges = this.generateEdges(nodeMap);
        this.d3Draw(tokens, nodeMap, edges, target);
    }

    private importSentence(data:SourceData.Data):Sentence {
        return data.desc.map((item, i) => {
            return {
                id: item[1],
                value: item[0],
                isKwic: false // testing (i - 1) because data.desc[0] == '#' character
            }
        });
    }

    /**
     * Calculate all the required drawing parameters
     * (widht/height if set to auto, y-step, x-step)
     */
    private calcViewSize(tokens:Sentence, nodeMap:TreeNodeMap):void {
        const totalNumLetters = tokens.reduce((prev, curr) => prev + curr.value.length, 0);
        const maxDepth = Object.keys(nodeMap).map(k => nodeMap[k].depth).reduce((p, c) => c > p ? c : p, 0);

        if (!this.params.width) {
            this.params.width = Math.min(this.params.maxWidth, tokens.length * TreeGenerator.NODE_DIV_WIDTH);
        }
        if (!this.params.height) {
            this.params.height = (maxDepth + 1) * TreeGenerator.NODE_DIV_HEIGHT +
                    TreeGenerator.DYNAMIC_VERTICAL_SPACING * maxDepth + TreeGenerator.DETAIL_DIV_MIN_HEIGHT;
        }
        if (this.params.height > this.params.maxHeight && typeof this.onOverflow === 'function') {
            [this.params.width, this.params.height] = this.onOverflow(this.params.width, this.params.height);
        }
        this.params.depthStep = (this.params.height - this.params.paddingTop - this.params.paddingBottom -
                TreeGenerator.DETAIL_DIV_MIN_HEIGHT) / maxDepth;
        this.params.cmlWordSteps = this.calculateWordSteps(tokens, nodeMap);
    }

    /**
     * Calculate nodes/words x-positions according to the available
     * width, number of words and their respective lengths.
     * The algorithm tries to optimize distances slightly to save some
     * space.
     */
    private calculateWordSteps(tokens:Sentence, nodeMap:TreeNodeMap):Array<number> {
        const baseStep = 5; // each step is a sum of this value and some calculated one
        const availWidth = this.params.getAvailWidth() - tokens.length * baseStep;
        const tmp = [];

        for (let i = 0; i < tokens.length; i += 1) {
            if (i + 1 < tokens.length
                    && (nodeMap[tokens[i + 1].id].depth < nodeMap[tokens[i].id].depth
                    || nodeMap[tokens[i + 1].id].depth - 1 === nodeMap[tokens[i].id].depth)) {
                tmp.push(tokens[i].value.length * TreeGenerator.HORIZONTAL_SPACING_COMPACT);

            } else {
                tmp.push(tokens[i].value.length * TreeGenerator.HORIZONTAL_SPACING_DEFAULT);
            }
        }
        const totalWeightedLetters = tmp.reduce((prev, curr) => prev + curr, 0);
        const cmlAns = [baseStep];
        for (let i = 0; i < tokens.length - 1; i += 1) {
            const step = tmp[i] / totalWeightedLetters * availWidth + baseStep;
            cmlAns.push(cmlAns[cmlAns.length - 1] + step);
        }
        return cmlAns;
    }

    /**
     *
     */
    private generateNodeMap(nodes:Array<SourceData.Node>):TreeNodeMap {
        const map:TreeNodeMap = {};
        nodes.forEach(item => {
            map[item.id] = {
                id: item.id,
                hint: item.hint,
                labels: item.labels.map(b => this.parseLabel(b)),
                parent: item.parent,
                depth: item.depth,
                data: item.data,
                x: 0,
                y: 0
            }
        });
        return map;
    }

    private generateEdges(nodeMap:TreeNodeMap):Array<Edge> {
        const ans:Array<Edge> = [];
        for (let k in nodeMap) {
            if (nodeMap.hasOwnProperty(k) && nodeMap[k].parent) {
                ans.push({
                    x1: nodeMap[k].x,
                    y1: nodeMap[k].y,
                    x2: nodeMap[nodeMap[k].parent].x,
                    y2: nodeMap[nodeMap[k].parent].y
                });
            }
        }
        return ans;
    }

    private generateNodeCoords(tokens:Sentence, nodeMap:TreeNodeMap) {
        tokens.forEach((item, i) => {
            const node = nodeMap[item.id];
            node.x = this.params.paddingLeft + this.params.cmlWordSteps[i];
            node.y = this.params.paddingTop + node.depth * this.params.depthStep;
        });
    }

    private parseLabel(s:string):Label {
        const srch = /#\{([^}]+)\}\[([^\]]+)/.exec(s);
        if (srch !== null) {
            return {
                color: srch[1],
                value: srch[2]
            };
        }
        return {
            color: '#000000',
            value: ''
        }
    }

    private generateLabelSpan(label:Label):string {
        const inlineCss = label.color ? `style="color: ${label.color}"` : '';
        return `<span class="label" ${inlineCss}>${label.value}</span>`;
    }

    private renderLinearSentence(tokens:Sentence, target:d3.Selection<SourceData.Token>):void {
       target
            .selectAll('span')
            .data(tokens)
            .enter()
            .append('span')
            .classed('token', true)
            .classed('kwic', d => d.isKwic)
            .text(d => d.value)
            .on('mouseover', (datum, i, values) => {
                d3.select(values[i])
                    .classed('focused', true);
                d3.select(this.sent2NodeActionMap[datum.id]).classed('focused', true);
            })
            .on('mouseout', (datum, i, values) => {
                d3.select(values[i])
                    .classed('focused', false);
                d3.select(this.sent2NodeActionMap[datum.id]).classed('focused', false);
            });

        target
            .selectAll('span.token')
            .each((d, i, nodes) => {
                this.node2SentActionMap[d.id] = nodes[i];
            });
    }

    private handleDetailClick(target:d3.Selection<Token>):void {

    }


    private renderNodeDiv(nodeMap:TreeNodeMap, target:d3.Selection<any>, group:d3.Selection<Token>) {
        const foreignObj = group.append('foreignObject');

        foreignObj
            .attr('x', (d, i) => this.params.paddingLeft + this.params.cmlWordSteps[i])
            .attr('y', d => this.params.paddingTop + nodeMap[d.id].depth * this.params.depthStep)
            .attr('transform', (d, i) => `translate(-10, 0)`)
            .attr('width', TreeGenerator.NODE_DIV_WIDTH)
            .attr('height', TreeGenerator.NODE_DIV_HEIGHT);

        const body = foreignObj
            .append("xhtml:body")
            .style('margin', 0)
            .style('padding', 0)
            .style('background', 'none');

        const generateNodeHtml = (t:Token, labels:Array<Label>) => {
            return [t.value].concat(labels.slice(1).map(v => this.generateLabelSpan(v))).join('<br />');
        };

        const div = body
            .append('xhtml:div')
            .classed('token-node', true)
            .attr('title', d => `${d.value} (${this.componentHelpers.translate('ucnkSyntaxViewer__click_to_see_details')})`)
            .html(d => generateNodeHtml(d, nodeMap[d.id].labels));

        div.each((d, i, items) => {
            this.sent2NodeActionMap[d.id] = items[i];
        });

        div
            .on('mouseover', (datum, i, elements) => {
                d3.select(elements[i]).classed('focused', true);
                d3.select(this.node2SentActionMap[datum.id]).classed('focused', true);
            })
            .on('mouseout', (datum, i, elements) => {
                d3.select(elements[i]).classed('focused', false);
                d3.select(this.node2SentActionMap[datum.id]).classed('focused', false);
            })
            .on('click', (datum, i, elements) => {
                target.selectAll('table').remove();
                if (!this.detailedId || this.detailedId !== datum.id) {
                    const table = target
                        .append('xhtml:table')
                        .classed('node-detail', true)
                        .style('left', `${nodeMap[datum.id].x + TreeGenerator.DETAIL_DIV_HORIZ_OFFSET}px`)
                        .style('top', `${nodeMap[datum.id].y + TreeGenerator.DETAIL_DIV_VERT_OFFSET}px`);

                    const tbody = table.append('tbody');

                    const link = tbody
                        .append('tr')
                        .append('td')
                        .classed('controls', true)
                        .attr('colspan', 2)
                        .append('a')
                        .on('click', (datum) => {
                            target.selectAll('table').remove();
                            this.detailedId = null;
                        });

                    link
                        .append('img')
                        .classed('close-button', true)
                        .attr('src', this.componentHelpers.createStaticUrl('img/close-icon.svg'))
                        .attr('alt', this.componentHelpers.translate('global__close'))
                        .attr('title', this.componentHelpers.translate('global__close'));

                    const data = nodeMap[datum.id].data;
                    Object.keys(data).filter(k => k !== 'id').forEach(k => {
                        const tr = tbody.append('tr');
                        tr
                            .append('th')
                            .text(k + ':');
                        const td = tr.append('td')
                        if (data[k] !== null && typeof data[k] === 'object') {
                            (<ReferencedValues>data[k]).forEach((item, i) => {
                                const refData = group.filter((_, j) => j === item[0]).datum();
                                if (refData) {
                                    if (i > 0) {
                                        td.append('span').text(', ');
                                    }
                                    td
                                        .append('a')
                                        .classed('detail-ref', true)
                                        .text(item[1])
                                        .on('mouseover', () => {
                                            d3.select(this.node2SentActionMap[refData.id]).classed('focused', true);
                                            d3.select(this.sent2NodeActionMap[refData.id]).classed('focused', true);
                                        })
                                        .on('mouseout', () => {
                                            d3.select(this.node2SentActionMap[refData.id]).classed('focused', false);
                                            d3.select(this.sent2NodeActionMap[refData.id]).classed('focused', false);
                                        });
                                }
                            });

                        } else if (typeof data[k] === 'string') {
                            td.text(<string>data[k]);
                        }
                    });
                    this.detailedId = datum.id;

                } else {
                    this.detailedId = null;
                }
            });
    }

    private d3Draw(tokens:Sentence, nodeMap:TreeNodeMap, edges:Array<Edge>, target:HTMLElement):void {
        const wrapper = d3.select(target);

        const sentDiv = wrapper
            .append('div')
            .classed('sentence', true);
        this.renderLinearSentence(tokens, sentDiv);

        const svg = d3
            .select(target)
            .append('svg')
            .attr('width', this.params.width)
            .attr('height', this.params.height);

        const edge = svg
            .selectAll('line')
            .data(edges)
            .enter()
            .append('line')
            .attr('x1', d => d.x1)
            .attr('y1', d => d.y1)
            .attr('x2', d => d.x2)
            .attr('y2', d => d.y2)
            .attr('stroke', this.params.edgeColor)
            .attr('stroke-width', this.params.edgeWidth);

        const group = svg
            .selectAll('g')
            .data(tokens)
            .enter()
            .append('g');
        group
            .append('ellipse')
            .attr('cx', (d, i) => nodeMap[d.id].x)
            .attr('cy', (d) => nodeMap[d.id].y)
            .attr('ry', this.params.nodeWidth)
            .attr('rx', this.params.nodeHeight)
            .attr('fill', this.params.nodeFill)
            .attr('stroke', this.params.nodeStrokeColor)
            .attr('stroke-width', '2');

        this.renderNodeDiv(nodeMap, wrapper, group);

    }
}


export interface TreeGeneratorFn {
    (data:Array<SourceData.Data>, zone:string, tree:string, target:HTMLElement, options:Options):void;
}


/**
 * This function is intended for the use in
 * KonText environment where componentHelpers is just
 * a bunch of functions used mainly by
 * React classes to translate messages,
 * format numbers and dates, generate links etc.
 */
export function createGenerator(componentHelpers:Kontext.ComponentHelpers):TreeGeneratorFn {
    return (data:Array<SourceData.Data>, zone:string, tree:string, target:HTMLElement,
            options:Options) => {
        const gen = new TreeGenerator(options, componentHelpers);
        gen.generate(data, zone, tree, target);
    }
}

/**
 * This function is used mainly for testing outside
 * the KonText environment.
 */
export function generate(data:Array<SourceData.Data>, zone:string, tree:string, target:HTMLElement,
        options:Options) {
    const helpers = {
        translate : (x, v) => x.replace(/[_-]/g, ' '),
        createStaticUrl : x => `../../../${x}`,
        createActionLink : x => x,
        getConf : k => null,
        formatNumber: v => v,
        formatDate: v => v,
        getLayoutViews: () => null,
        addGlobalKeyEventHandler:(fn:(evt:Event)=>void):void => {},
        removeGlobalKeyEventHandler:(fn:(evt:Event)=>void):void => {},
        cloneState:<T extends {[key:string]:any}>(obj:T):T => obj,
        doThingsWithDelay:(immediateFn:()=>void, actualFn:()=>void, delay:number) => undefined,
        getHelpLink:(ident:string) => '',
        browserInfo: {
            isFirefox: () => false
        }
    };
    const gen = new TreeGenerator(options, helpers);
    gen.generate(data, zone, tree, target);
}

