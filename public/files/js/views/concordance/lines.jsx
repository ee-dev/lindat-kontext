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

import * as React from 'vendor/react';

import {init as initMediaViews} from './media';
import {calcTextColorFromBg, color2str, importColor} from '../../util';
import {init as lineExtrasViewsInit} from './lineExtras';


export function init(dispatcher, he, lineStore, lineSelectionStore) {

    const mediaViews = initMediaViews(dispatcher, he, lineStore);
    const extras = lineExtrasViewsInit(dispatcher, he);

    // ------------------------- <ConcColHideSwitch /> ---------------------------

    const ConcColHideSwitch = (props) => {

        const handleChange = (_) => {
            dispatcher.dispatch({
                actionType: 'CONCORDANCE_CHANGE_LANG_VISIBILITY',
                props: {
                    corpusId: props.corpusId,
                    value: !props.isVisible
                }
            });
        }

        const title = props.isVisible ?
                he.translate('concview__click_to_hide_the_corpus') :
                he.translate('concview__click_to_show_the_corpus');

        return (
            <input type="checkbox" style={{verticalAlign: 'middle'}}
                title={title} checked={props.isVisible}
                onChange={handleChange} />
        );
    }

    // ------------------------- <ConcColsHeading /> ---------------------------

    const ConcColsHeading = (props) => {

        const handleSetMainCorpClick = (corpusId) => {
            if (props.corpsWithKwic.indexOf(corpusId) > -1) {
                dispatcher.dispatch({
                    actionType: 'CONCORDANCE_CHANGE_MAIN_CORPUS',
                    props: {
                        maincorp: corpusId
                    }
                });

            } else {
                dispatcher.dispatch({
                    actionType: 'MAIN_MENU_SHOW_FILTER',
                    props: {
                        within: 1,
                        maincorp: corpusId
                    }
                });
            }
        };

        const renderCol = (corpInfo) => {
            const colSpan = props.viewMode === 'kwic' ? 3 : 1;

            const htmlClass = corpInfo.visible ? 'concordance-col-heading' : 'concordance-col-heading-hidden';

            return [
                <td key={'ref:' + corpInfo.n}>{/* matches reference column */}</td>,
                <td key={corpInfo.n} className={htmlClass} colSpan={colSpan}>
                    <a className="select-primary-lang" onClick={handleSetMainCorpClick.bind(null, corpInfo.n)}
                                title={corpInfo.visible ? '' : corpInfo.label}>
                        {corpInfo.visible ? corpInfo.label : '\u2026'}
                    </a>
                    {props.hideable || !corpInfo.visible ?
                        <ConcColHideSwitch corpusId={corpInfo.n} isVisible={corpInfo.visible} /> :
                        null}
                </td>
            ];
        };

        return (
            <tr>
                <td>{/* matches line number column */}</td>
                <td>{/* matches selection checkbox column */}</td>
                <td>{/* matches syntax tree column */}</td>
                {props.cols.map(item => renderCol(item))}
            </tr>
        );
    };

    // ------------------------- <NonKwicText /> ---------------------------

    const NonKwicText = (props) => {

        const hasClass = (cls) => {
            return props.data.className.indexOf(cls) > -1;
        };

        const mkKey = () => {
            return `${props.position}:${props.idx}`;
        };

        const mkTokenId = (i) => {
            return props.kwicTokenNum + props.chunkOffset + i;
        };

        const splitTokens = (text) => {
            const ans = [];
            props.data.text.forEach((s, i) => {
                ans.push(' ');
                ans.push(<mark key={`${props.position}:${props.idx}:${i}`} data-tokenId={mkTokenId(i)}>{s}</mark>);
            });
            ans.push(' ');
            return ans;
        };

        if (props.data.className && props.data.text) {
            if (hasClass('coll') && !hasClass('col0')) {
                return(
                    <em key={mkKey()} className={props.data.className}>
                        {props.data.text}
                    </em>
                );

            } else {
                return (
                    <span key={mkKey()} className={props.data.className}>
                        {props.data.text}
                    </span>
                );
            }

        } else {
            return (
                <span key={mkKey()} title={(props.data.mouseover || []).join(', ')}>
                    {splitTokens(props.data.text)}
                </span>
            );
        }
    };

    // ------------------------- <Line /> ---------------------------

    class Line extends React.Component {

        constructor(props) {
            super(props);
            this.state = this._fetchStoreState();
            this._handleStoreChange = this._handleStoreChange.bind(this);
        }

        _fetchStoreState() {
            return {
                selectionValue: lineSelectionStore.getLine(this.props.data.languages.first().tokenNumber)
            };
        }

        _renderLeftChunk(chunkOffsets, kwicTokenNum, item, i, itemList) {
            const ans = [];
            if (i > 0 && itemList.get(i - 1).closeLink) {
                ans.push(<extras.AudioLink t="+" lineIdx={this.props.lineIdx} corpname={this.props.baseCorpname}
                            chunks={[itemList.get(i - 1), item]} />);
            }
            if (item.openLink) {
                ans.push(<extras.AudioLink t="L" lineIdx={this.props.lineIdx} corpname={this.props.baseCorpname}
                            chunks={[item]} />);
            }
            ans.push(<NonKwicText data={item} idx={i} position="l" chunkOffset={-1 * chunkOffsets.get(i)} kwicTokenNum={kwicTokenNum} />);
            if (item.closeLink) {
                ans.push(<extras.AudioLink t="R" lineIdx={this.props.lineIdx} corpname={this.props.baseCorpname}
                            chunks={[item]} />);
            }
            return ans;
        }

        _renderKwicChunk(prevBlockClosed, hasKwic, item, i, itemList) {
            const ans = [];
            const mouseover = (item.mouseover || []).join(', ');
            const prevClosed = i > 0 ? itemList.get(i - 1) : prevBlockClosed;
            if (prevClosed && item.openLink) {
                ans.push(<extras.AudioLink t="+" lineIdx={this.props.lineIdx} corpname={this.props.baseCorpname}
                        chunks={[prevClosed, item]} />);

            } else if (i > 0 && itemList.get(i - 1).closeLink) {
                ans.push(<extras.AudioLink t="+" lineIdx={this.props.lineIdx} corpname={this.props.baseCorpname}
                        chunks={[itemList.get(i - 1), item]} />);
            }
            if (hasKwic) {
                ans.push(<strong key={'k:' + String(i)} className={item.className} title={mouseover}>{item.text}</strong>);

            } else if (!item.text) {
                ans.push('<--not translated-->');

            } else {
                ans.push(item.text);
            }
            return ans;
        }

        _renderRightChunk(chunkOffsets, kwicTokenNum, prevBlockClosed, item, i, itemList) {
            const ans = [];
            const mouseover = (item.mouseover || []).join(', ');
            const prevClosed = i > 0 ? itemList.get(i - 1) : prevBlockClosed;
            if (prevClosed && item.openLink) {
                ans.push(<extras.AudioLink t="+" lineIdx={this.props.lineIdx} corpname={this.props.baseCorpname}
                            chunks={[prevClosed, item]} />);

            } else if (i > 0 && itemList.get(i - 1).closeLink) {
                ans.push(<extras.AudioLink t="+" lineIdx={this.props.lineIdx} corpname={this.props.baseCorpname}
                            chunks={[itemList.get(i - 1), item]} />);
            }
            if (item.openLink) {
                ans.push(<extras.AudioLink t="L" lineIdx={this.props.lineIdx} corpname={this.props.baseCorpname}
                            chunks={[item]} />);
            }
            ans.push(<NonKwicText data={item} idx={i} position="r" chunkOffset={chunkOffsets.get(i)} kwicTokenNum={kwicTokenNum} />);
            if (item.closeLink) {
                ans.push(<extras.AudioLink t="R" lineIdx={this.props.lineIdx} corpname={this.props.baseCorpname}
                            chunks={[item]} />);
            }
            return ans;
        }

        _exportTextElmClass(corpname, ...customClasses) {
            const ans = customClasses.slice();
            if (corpname === this.props.mainCorp) {
                ans.push('maincorp');
            }
            return ans.join(' ');
        }

        _renderTextKwicMode(corpname, corpusOutput) {
            const hasKwic = this.props.corpsWithKwic.indexOf(corpname) > -1;
            const handleTokenClick = (evt) => this._handleNonKwicTokenClick(
                corpname, this.props.lineIdx, Number(evt.target.getAttribute('data-tokenId'))
            );
            return [
                <td
                        key="lc"
                        className={this._exportTextElmClass(corpname, 'lc')}
                        onClick={handleTokenClick}>
                    {corpusOutput.left.map(this._renderLeftChunk.bind(this, corpusOutput.leftOffsets, corpusOutput.tokenNumber))}
                </td>,
                <td
                        key="kw"
                        className={this._exportTextElmClass(corpname, 'kw')}
                        onClick={this._handleKwicClick.bind(this, corpname,
                                 corpusOutput.tokenNumber, this.props.lineIdx)}>
                    {corpusOutput.kwic.map(this._renderKwicChunk.bind(this, corpusOutput.left.get(-1), hasKwic))}
                </td>,
                <td
                        key="rc"
                        className={this._exportTextElmClass(corpname, 'rc')}
                        onClick={handleTokenClick}>
                    {corpusOutput.right.map(this._renderRightChunk.bind(this, corpusOutput.rightOffsets, corpusOutput.tokenNumber,
                        corpusOutput.kwic.get(-1)))}
                </td>
            ];
        }

        _renderTextParMode(corpname, corpusOutput) {
            const hasKwic = this.props.corpsWithKwic.indexOf(corpname) > -1;
            const handleTokenClick = (evt) => this._handleNonKwicTokenClick(
                corpname, this.props.lineIdx, Number(evt.target.getAttribute('data-tokenId'))
            );
            return [
                <td key="par" className={this._exportTextElmClass(corpname, 'par')}>
                    <span onClick={handleTokenClick}>
                        {corpusOutput.left.map(this._renderLeftChunk.bind(this, corpusOutput.leftOffsets, corpusOutput.tokenNumber))}
                    </span>
                    <span onClick={this._handleKwicClick.bind(this, corpname,
                                 corpusOutput.tokenNumber, this.props.lineIdx)}>
                        {corpusOutput.kwic.map(this._renderKwicChunk.bind(this, corpusOutput.left.get(-1), hasKwic))}
                    </span>
                    <span onClick={handleTokenClick}>
                        {corpusOutput.right.map(this._renderRightChunk.bind(this, corpusOutput.rightOffsets, corpusOutput.tokenNumber, corpusOutput.kwic.get(-1)))}
                    </span>
                </td>
            ]
        }

        _renderText(corpusOutput, corpusIdx) {
            const corpname = this.props.cols.get(corpusIdx).n;
            if (this.props.viewMode === 'kwic') {
                return this._renderTextKwicMode(corpname, corpusOutput);

            } else {
                return this._renderTextParMode(corpname, corpusOutput);
            }
        }

        _renderTextSimple(corpusOutput, corpusIdx) {
            const mp  = v => v.text;
            return corpusOutput.left.map(mp)
                    .concat(corpusOutput.kwic.map(mp))
                    .concat(corpusOutput.right.map(mp))
                    .join(' ');
        }

        _handleKwicClick(corpusId, tokenNumber, lineIdx) {
            this.props.tokenDetailClickHandler(corpusId, tokenNumber, this.props.data.kwicLength, lineIdx);
        }

        _handleNonKwicTokenClick(corpusId, lineIdx, tokenNumber) {
            this.props.tokenDetailClickHandler(corpusId, tokenNumber, -1, lineIdx);
        }

        _handleStoreChange() {
            this.setState(this._fetchStoreState());
        }

        shouldComponentUpdate(nextProps, nextState) {
            return this.state.selectionValue !== nextState.selectionValue ||
                    this.props.data !== nextProps.data ||
                    this.props.lineSelMode !== nextProps.lineSelMode ||
                    this.props.audioPlayerIsVisible !== nextProps.audioPlayerIsVisible ||
                    this.props.catBgColor != nextProps.catBgColor ||
                    this.props.cols !== nextProps.cols ||
                    this.props.viewMode !== nextProps.viewMode;
        }

        componentDidMount() {
            lineSelectionStore.addChangeListener(this._handleStoreChange);
        }

        componentWillUnmount() {
            lineSelectionStore.removeChangeListener(this._handleStoreChange);
        }

        render() {
            const primaryLang = this.props.data.languages.first();
            const alignedCorpora = this.props.data.languages.rest();
            const htmlClasses = [];
            if (this.props.data.hasFocus) {
                htmlClasses.push('active');
            }
            return (
                <tr className={htmlClasses.join(' ')}>
                    <td className="line-num">{this.props.showLineNumbers ? this.props.data.lineNumber + 1 : null}</td>
                    <extras.TdLineSelection
                        kwicLength={this.props.data.kwicLength}
                        tokenNumber={primaryLang.tokenNumber}
                        lineNumber={this.props.data.lineNumber}
                        mode={this.props.lineSelMode}
                        lockedGroupId={this.props.numItemsInLockedGroups > 0 ? this.props.data.lineGroup : null}
                        catBgColor={this.props.catBgColor}
                        catTextColor={this.props.catTextColor}
                        selectionValue={this.state.selectionValue} />
                    <td className="syntax-tree">
                        {this.props.supportsSyntaxView ?
                            <extras.SyntaxTreeButton
                                    onSyntaxViewClick={()=>this.props.onSyntaxViewClick(primaryLang.tokenNumber, this.props.data.kwicLength)}
                                    tokenNumber={primaryLang.tokenNumber}
                                    kwicLength={this.props.data.kwicLength} /> :
                            null
                        }
                    </td>
                    <td className="ref">
                        {this.props.cols.get(0).visible ?
                            <extras.RefInfo corpusId={this.props.cols.get(0).n}
                                    tokenNumber={primaryLang.tokenNumber}
                                    lineIdx={this.props.lineIdx}
                                    data={primaryLang.ref}
                                    refsDetailClickHandler={this.props.refsDetailClickHandler}
                                    emptyRefValPlaceholder={this.props.emptyRefValPlaceholder} /> :
                            null}

                    </td>
                    {this.props.cols.get(0).visible ?
                            this._renderText(primaryLang, 0) :
                            <td key="par" title={this._renderTextSimple(primaryLang, 0)}>{'\u2026'}</td>
                    }
                    {alignedCorpora.map((alCorp, i) => {
                        if (this.props.cols.get(i + 1).visible) {
                            return [
                                (<td className="ref">
                                    <extras.RefInfo corpusId={this.props.cols.get(i + 1).n}
                                        tokenNumber={alCorp.tokenNumber}
                                        lineIdx={this.props.lineIdx}
                                        data={alCorp.ref}
                                        refsDetailClickHandler={this.props.refsDetailClickHandler} />
                                </td>),
                                this._renderText(alCorp, i + 1)
                            ];

                        } else {
                            return [
                                <td className="ref" />,
                                <td key="par" title={this._renderTextSimple(alCorp, i + 1)}>{'\u2026'}</td>
                            ];
                        }
                    })}
                </tr>
            );
        }
    }

    // ------------------------- <ConcLines /> ---------------------------

    class ConcLines extends React.Component {

        constructor(props) {
            super(props);
            this._storeChangeListener = this._storeChangeListener.bind(this);
            this.state = this._fetchStoreState();
        }

        _getLineSelMode() {
            if (lineStore.getNumItemsInLockedGroups() > 0) {
                return 'groups';

            } else {
                return lineSelectionStore.getMode();
            }
        }

        _fetchStoreState() {
            return {
                lines: lineStore.getLines(),
                lineSelData: lineSelectionStore.asMap(),
                lineSelMode: this._getLineSelMode(),
                numItemsInLockedGroups: lineStore.getNumItemsInLockedGroups(),
                audioPlayerIsVisible: lineStore.audioPlayerIsVisible(),
                useSafeFont: lineStore.getUseSafeFont(),
                emptyRefValPlaceholder: lineStore.getEmptyRefValPlaceholder(),
                corporaColumns: lineStore.getCorporaColumns(),
                viewMode: lineStore.getViewMode()
            };
        }

        _storeChangeListener() {
            this.setState(this._fetchStoreState());
        }

        componentDidMount() {
            lineStore.addChangeListener(this._storeChangeListener);
            lineSelectionStore.addChangeListener(this._storeChangeListener);
            if (typeof this.props.onReady === 'function') { // <-- a glue with legacy code
                this.props.onReady();
            }
        }

        componentWillUnmount() {
            lineStore.removeChangeListener(this._storeChangeListener);
            lineSelectionStore.removeChangeListener(this._storeChangeListener);
        }

        _getCatColors(dataItem) {
            const tmp = this.state.lineSelData.get(dataItem.languages.first().tokenNumber);
            const cat = tmp ? tmp[1] : dataItem.lineGroup;
            if (cat >= 1) {
                const bgColor = this.props.catColors[cat % this.props.catColors.length];
                const fgColor = color2str(calcTextColorFromBg(importColor(bgColor, 0)));
                return [color2str(importColor(bgColor, 0.9)), fgColor];
            }
            return [null, null];
        }

        _renderLine(item, i) {
            const catColor = this._getCatColors(item);
            return <Line key={String(i) + ':' + item.languages.first().tokenNumber}
                         lineIdx={i}
                         data={item}
                         cols={this.state.corporaColumns}
                         viewMode={this.state.viewMode}
                         baseCorpname={this.props.baseCorpname}
                         mainCorp={this.props.mainCorp}
                         corpsWithKwic={this.props.KWICCorps}
                         showLineNumbers={this.props.ShowLineNumbers}
                         lineSelMode={this.state.lineSelMode}
                         numItemsInLockedGroups={this.state.numItemsInLockedGroups}
                         audioPlayerIsVisible={this.state.audioPlayerIsVisible}
                         tokenDetailClickHandler={this.props.tokenDetailClickHandler}
                         refsDetailClickHandler={this.props.refsDetailClickHandler}
                         emptyRefValPlaceholder={this.state.emptyRefValPlaceholder}
                         catBgColor={catColor[0]}
                         catTextColor={catColor[1]}
                         supportsSyntaxView={this.props.supportsSyntaxView}
                         onSyntaxViewClick={this.props.onSyntaxViewClick} />;
        }

        render() {
            const numVisibleCols = this.state.corporaColumns.reduce((prev, c) => prev + (c.visible ? 1 : 0), 0);
            return (
                <table id="conclines" className={this.state.useSafeFont ? 'safe' : null}>
                    <tbody>
                        {this.state.corporaColumns.size > 1 ?
                            <ConcColsHeading cols={this.state.corporaColumns} corpsWithKwic={this.props.KWICCorps}
                                    viewMode={this.state.viewMode} hideable={numVisibleCols > 1} />
                            : null
                        }
                        {this.state.lines.map(this._renderLine.bind(this))}
                    </tbody>
                </table>
            );
        }
    }

    return {
        ConcLines: ConcLines
    };
}