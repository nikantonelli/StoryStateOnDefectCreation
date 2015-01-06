Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    items: { xtype: 'container',
        items:[
            {
                xtype: 'datefield',
                fieldLabel: 'Start Date',
                id: 'startDate',
                value: new Date(new Date()-1209600000),   //Possible 2week iteration?
                format: "d M Y",
                margin: 10
            },
            {
                xtype: 'datefield',
                fieldLabel: 'End Date',
                id: 'endDate',
                value: new Date(),
                format: "d M Y",
                margin: 10
            },
            {
                xtype: 'rallybutton',
                text: 'Run Query',
                margin: 10
            }
        ],
        margin: 10,
        layout: 'column',
        border: 5,
        style: {
            borderColor: Rally.util.Colors.cyan,
            borderStyle: 'solid'
        }
    },

    storyStats: null,
    unparentedDefects: 0,
    totalDefects: 0,
    processedDefects: 0,

    fieldFetched: "c_ARTKanban",

    //Get the allowed values for the field into a map into the right order
    _populateStateMap: function(app){

        Rally.data.ModelFactory.getModels({
            types: ['UserStory'],
            success: function (models) {
                var usModel = models.UserStory;
                var field = usModel.getField(app.fieldFetched);
                var valueStore = field.getAllowedValueStore();
                valueStore.load({
                    callback: function(records, operation, success) {
                        if (success) {
                            app.storyStats = new Map();
                            Ext.Array.each(records, function(allowedValue){
                                var sv = allowedValue.get('StringValue');
                                if (sv === "") sv = "None";
                                app.storyStats.set(sv,0);
                            });
                        }
                    }
                });
            },
            failure: function() {
                console.log("Failure to retrieve allowed values of field: " + app.fieldFetched);
            }
        });

    },

    _runQuery: function(){

        var app = this;

        //Might rerun query, so clear out markers
        app.processedDefects = 0;
        app.unparentedDefects = 0;
        app.totalDefects = 0;


        //Reset the stats values
        if (app.storyStats){
            app.storyStats.forEach( function(value,key,map) {
                app.storyStats.set(key,0);
            });
        }

        //Get all the defects created during this period using the WSAPI

        var defectStore = Ext.create('Rally.data.wsapi.Store', {
            autoLoad: false,
            model: 'Defect',
            fetch: [ 'Requirement', 'CreationDate'],
            filters: [
                {
                    property: 'creationDate',
                    operator: '<',
                    value: Ext.Date.format(Ext.getCmp('endDate').value, "Y-m-d\\TH:i:s")
                },
                {
                    property: 'creationDate',
                    operator: '>=',
                    value: Ext.Date.format(Ext.getCmp('startDate').value, "Y-m-d\\TH:i:s")
                }
            ]
        });

        defectStore.load().then({
            success: function(records) {


                _.each(records, function(record) {
                    if (record.data.Requirement) {


                        //Then call the LBAPI per US to find the state when the defect was created
                        //Because we have a different timestamp for each defect, we cannot fetch in bulk only individually.
                        app.addStoryStats(record.data.Requirement, record.data.CreationDate);
                    } else {
                        app.unparentedDefects += 1;
                    }
                });

            },
            failure: function(error) {
                            console.log(error);
            }
        });

    },

    addStoryStats: function(story, creationDate) {

        var app = this; //Scoped to the app in the launch() function via runQuery()

        var storyHistoryStore = Ext.create('Rally.data.lookback.SnapshotStore', {
                autoLoad: true,
                fetch: ['Name','FormattedID',app.fieldFetched],
                hydrate: ['FormattedID', app.fieldFetched],
                filters: [
                    {
                        property: '_TypeHierarchy',
                        operator: '=',
                        value: 'HierarchicalRequirement'
                    },
                    {
                        property: '__At',
                        value: creationDate
                    },
                    {
                        property: 'ObjectID',
                        operator: '=',
                        value: Rally.util.Ref.getOidFromRef(story)
                    }
                ],
                sorters: [
                    {
                        property: '_ValidFrom',
                        direction: 'ASC'
                    }
                ],


                listeners: {
                    beforeload: function() {
                    
                        //Note that there is one to fetch the details for
                        app.totalDefects +=1;
                    },

                    load: function(storyHistoryStore, records) {
                        if (records.length) {
                            //If unset, then use the word "None"
                            if (records[0].get(app.fieldFetched) === "")
                                records[0].set(app.fieldFetched,"None");

                            if (app.storyStats.has(records[0].get(app.fieldFetched))) {
                                app.storyStats.set(records[0].get(app.fieldFetched),
                                        app.storyStats.get(records[0].get(app.fieldFetched)) + 1);

                            }
                            else {
                                app.storyStats.set(records[0].get(app.fieldFetched), 1);
                            }
                        }

                        app.processedDefects += 1;

                        if (app.totalDefects <= app.processedDefects){
                            //Not sure how to bulk these up into one refresh of the chart apart from delete and rebuild
                            //when we have seen all the defect details loaded.
                            app.refreshChart(app);

                        }

                    }

                }

        });
        Ext.util.Observable.capture( storyHistoryStore, function(event) { console.log(event, arguments);});
    },

    refreshChart: function(app){

        if (app.down('rallychart')) {
            app.down('rallychart').destroy();
        }

        if (app.down('text')) {
            app.down('text').destroy();
        }

        app.add( {
            xtype: 'rallychart',
            chartData:
            {
                categories: app._getStates(app),
                series: [
                    
                        {
                            name: 'Story State',
                            data: app._getNumbers(app)
                        }

                ]
            },
            chartConfig: app._getChartConfig(),
            chartColors: [ Rally.util.Colors.cyan ],
            loadMask: false

        });
        app.add( {
            xtype: 'text',
            text: "Unparented Defects: " + app.unparentedDefects,
            margin: 10
        });

    },

    _getStates: function(app) {

        var states = [];

        app.storyStats.forEach(function(value,key,map) {
            states.push(key);
        });
        return states;
    },

    _getNumbers: function(app) {

        var numbers = [];

        app.storyStats.forEach(function(value,key,map) {
            numbers.push(value);
        });
        return numbers;
    },

    /**
     * Generate a valid Highcharts configuration object to specify the column chart
     */
    _getChartConfig: function() {
        return {
            chart: {
                type: 'column'
            },
            title: {
                text: 'Story State on Defect Creation'
            },
            xAxis: {
            },
            yAxis: {
                min: 0,
                    title: {
                    text: 'Count'
                }
            },
            tooltip: {
                headerFormat: '<span style="font-size:10px">{point.key}</span><table>',
                    pointFormat: '<tr><td style="color:{series.color};padding:0"> </td>' +
                    '<td style="padding:0"><b>{point.y} Stories</b></td></tr>',
                    footerFormat: '</table>',
                    shared: true,
                    useHTML: true
            },
            plotOptions: {
                column: {
                    pointPadding: 0.2,
                        borderWidth: 0
                }
            }
        };
    },


    launch: function() {


        //Populate stats map with the options for the selected field
        this._populateStateMap(this);

        //Add an action to the button
        this.down('rallybutton').on({
            click: this._runQuery,
            scope: this
        });
        this._runQuery();
    }
});
